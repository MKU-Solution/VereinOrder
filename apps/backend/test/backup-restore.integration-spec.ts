import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PrismaClient } from "@vereinorder/database";
import { assertTestDatabaseUrl } from "./test-database";
import { BackupService } from "../src/backup/backup.service";
import { OrdersService } from "../src/orders/orders.service";
import { createAuditServiceStub } from "../src/orders/test-support/audit-service.stub";

/**
 * Wächtertest gegen eine echte PostgreSQL-Instanz für Issue #103
 * ("Wiederherstellung funktioniert nicht — sie bricht in der ersten
 * Anweisung ab").
 *
 * Der bestehende Attrappentest (backup.service.spec.ts) arbeitet mit einem
 * Prisma-Mock, der keine Fremdschlüssel, keine Sequenzen und kein
 * ON DELETE CASCADE kennt. Genau deshalb hat er den in B1 beschriebenen
 * Totalausfall der Wiederherstellung nicht gefangen: restoreBackup ist seit
 * seiner Entstehung in keinem einzigen Lauf gegen eine echte Datenbank
 * durchgelaufen. Dieser Test spielt deshalb den vollständigen Weg gegen
 * echtes PostgreSQL durch: Bestand füllen, sichern, wiederherstellen,
 * vergleichen, und danach einen weiteren Verkauf buchen — das ist die
 * Prüfung, die zeigt, dass Abholnummernzähler und Bestellnummernsequenz
 * tatsächlich nachgesetzt wurden und nicht nur zufällig weiterlaufen.
 */
describe("BackupService.restoreBackup – Wiederherstellung gegen echtes PostgreSQL (Issue #103)", () => {
  assertTestDatabaseUrl();

  const prisma = new PrismaClient();
  let backupDir: string;
  let previousBackupDir: string | undefined;
  let backupService: BackupService;
  const ordersService = new OrdersService(
    prisma,
    createAuditServiceStub() as any,
  );

  const cleanupUserIds: string[] = [];
  const cleanupEventIds: string[] = [];
  const cleanupPrinterIds: string[] = [];

  beforeAll(() => {
    previousBackupDir = process.env.BACKUP_DIR;
    backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-restore-integration-"),
    );
    process.env.BACKUP_DIR = backupDir;
    // Legacy-Wiederherstellung ist ausschließlich im gesperrten
    // Wartungsmodus zulässig. Der Test ruft den internen Legacy-Weg bewusst
    // direkt auf und bildet deshalb die verbindliche LOCKED-Vorbedingung ab.
    backupService = new BackupService(
      prisma as any,
      {
        read: () => ({ phase: "LOCKED" }),
      } as any,
    );
  });

  afterAll(async () => {
    // Bestellungen zuerst: "OrderItem"."productId" ist ON DELETE RESTRICT,
    // und Order/Product hängen beide (getrennt) an Event. Würde Event zuerst
    // gelöscht, koennte Postgres die Produkt-Kaskade vor der Bestell-Kaskade
    // verarbeiten und die RESTRICT-Pruefung schlaegt fehl, obwohl die
    // Bestellung im selben Atemzug ohnehin verschwaende. Explizit zuerst
    // loeschen macht die Reihenfolge unabhaengig von dieser Verarbeitungsfolge.
    if (cleanupEventIds.length) {
      await prisma.order.deleteMany({
        where: { eventId: { in: cleanupEventIds } },
      });
      await prisma.event.deleteMany({ where: { id: { in: cleanupEventIds } } });
    }
    if (cleanupUserIds.length) {
      await prisma.auditLog.deleteMany({
        where: { userId: { in: cleanupUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    }
    if (cleanupPrinterIds.length) {
      // PrintJob."printerId" ist ON DELETE RESTRICT und "orderId" ist kein
      // Fremdschlüssel (bewusst so im Schema — historische Druckaufträge
      // dürfen ihre Bestellung überleben), Druckaufträge aus dem
      // Verkaufstest (dispatchPrintJobs) müssen deshalb hier explizit weg.
      await prisma.printJob.deleteMany({
        where: { printerId: { in: cleanupPrinterIds } },
      });
      await prisma.printer.deleteMany({
        where: { id: { in: cleanupPrinterIds } },
      });
    }
    await prisma.$disconnect();

    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDir;
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it("setzt bei einer Sicherung ohne Bestellungen die Sequenz auf die erste gültige Nummer", async () => {
    const admin = await prisma.user.create({
      data: {
        username: `waechtertest-leerer-restore-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    cleanupUserIds.push(admin.id);

    const event = await prisma.event.create({
      data: { name: `Wächtertest leerer Restore ${randomUUID()}` },
    });
    cleanupEventIds.push(event.id);

    expect(await prisma.order.count()).toBe(0);
    const backup = await backupService.createBackup(admin.id);

    // Beweist, dass der Restore nicht nur einen zufällig schon passenden
    // Sequenzstand übernimmt. Auf einer leeren Tabelle ist 1,false die einzig
    // korrekte SERIAL-Basis; 0 ist für diese Sequenz ungültig.
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Order"', 'orderNumber'), 37, true)`,
    );

    await expect(
      backupService.restoreBackup(backup.filename, admin.id),
    ).resolves.toMatchObject({ success: true });

    const firstOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        dataMode: "LIVE",
        totalAmount: 100,
      },
    });
    expect(firstOrder.orderNumber).toBe(1);
  }, 30_000);

  it("stellt Bestellungen, Zahlungen, Produktbons und Auditurheber vollständig wieder her und setzt Zähler und Sequenz nach", async () => {
    // -----------------------------------------------------------------
    // 1. Belastbaren Bestand aufbauen.
    // -----------------------------------------------------------------
    const admin = await prisma.user.create({
      data: {
        username: `waechtertest-restore-admin-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    const cashier = await prisma.user.create({
      data: {
        username: `waechtertest-restore-cashier-${randomUUID()}`,
        pinHash: "x",
        role: "CASHIER",
      },
    });
    cleanupUserIds.push(admin.id, cashier.id);

    const printer = await prisma.printer.create({
      data: { name: `Wächtertest-Drucker ${randomUUID()}`, type: "CONSOLE" },
    });
    cleanupPrinterIds.push(printer.id);

    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Wiederherstellung ${randomUUID()}`,
        status: "ACTIVE",
        testMode: false,
      },
    });
    cleanupEventIds.push(event.id);

    const station = await prisma.station.create({
      data: { name: "Getränkestand", eventId: event.id },
    });
    const category = await prisma.productCategory.create({
      data: { name: "Getränke", eventId: event.id },
    });
    const product = await prisma.product.create({
      data: {
        name: "Bier",
        price: 350,
        eventId: event.id,
        categoryId: category.id,
        targetStationId: station.id,
      },
    });
    const session = await prisma.cashierSession.create({
      data: {
        userId: cashier.id,
        eventId: event.id,
        dataMode: "LIVE",
        status: "ACTIVE",
      },
    });

    // Zwei Bestellungen mit Positionen, Zahlungen und Produktbons — der
    // "belastbare Bestand" aus dem Auftrag, nicht nur eine leere Hülle.
    const order1 = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 700,
        // Issue #165: paymentStatus wird an jedem Schreibpfad aus der Summe
        // der abgeschlossenen Zahlungen abgeleitet; die Backup-Dokumentgrenze
        // prüft das inzwischen nach. Die direkt gesäte Zeile hier muss diese
        // Ableitung von Hand nachbilden, sonst würde die eigene Sicherung
        // dieses Wächtertests an der neuen Prüfung scheitern.
        paymentStatus: "PAID",
        pickupNumber: 1,
        stationId: station.id,
        cashierSessionId: session.id,
        items: {
          create: [{ productId: product.id, quantity: 2, priceAtTime: 350 }],
        },
        payments: {
          create: [
            {
              amount: 700,
              method: "CASH",
              tenderedAmount: 1000,
              changeAmount: 300,
              cashierSessionId: session.id,
            },
          ],
        },
      },
      include: { items: true },
    });
    const order2 = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 350,
        // Issue #165: siehe Kommentar bei order1.
        paymentStatus: "PAID",
        pickupNumber: 2,
        stationId: station.id,
        cashierSessionId: session.id,
        items: {
          create: [{ productId: product.id, quantity: 1, priceAtTime: 350 }],
        },
        payments: {
          create: [
            {
              amount: 350,
              method: "CASH",
              tenderedAmount: 350,
              changeAmount: 0,
              cashierSessionId: session.id,
            },
          ],
        },
      },
      include: { items: true },
    });

    // Produktbons: order1 hat zwei Einheiten, order2 eine — drei insgesamt.
    for (let unit = 0; unit < 2; unit += 1) {
      await prisma.productVoucher.create({
        data: {
          code: `WT-${randomUUID()}`,
          eventId: event.id,
          productId: product.id,
          orderId: order1.id,
          orderItemId: order1.items[0].id,
          issuedByUserId: cashier.id,
          cashierSessionId: session.id,
        },
      });
    }
    await prisma.productVoucher.create({
      data: {
        code: `WT-${randomUUID()}`,
        eventId: event.id,
        productId: product.id,
        orderId: order2.id,
        orderItemId: order2.items[0].id,
        issuedByUserId: cashier.id,
        cashierSessionId: session.id,
      },
    });

    // Der Abholnummernzähler, wie ihn drawPickupNumber nach zwei Verkäufen
    // hinterlassen hätte. EventPickupCounter wird bewusst NICHT gesichert
    // (siehe unten) — dieser Wert dient nur dazu, dass vor der Sicherung ein
    // realistischer Zustand besteht.
    await prisma.eventPickupCounter.create({
      data: { eventId: event.id, dataMode: "LIVE", lastNumber: 2 },
    });

    // Audit-Einträge mit echtem Urheber — genau das, was B7 nach einer
    // Wiederherstellung auf "System" zurücksetzt, wenn es nicht behoben ist.
    const auditLogin = await prisma.auditLog.create({
      data: {
        action: "LOGIN",
        entityId: admin.id,
        entityType: "User",
        userId: admin.id,
        details: { via: "waechtertest" },
      },
    });
    const auditSale1 = await prisma.auditLog.create({
      data: {
        action: "QUICK_SALE_COMPLETED",
        entityId: order1.id,
        entityType: "Order",
        userId: cashier.id,
        details: { totalAmount: 700 },
      },
    });
    const auditSale2 = await prisma.auditLog.create({
      data: {
        action: "QUICK_SALE_COMPLETED",
        entityId: order2.id,
        entityType: "Order",
        userId: cashier.id,
        details: { totalAmount: 350 },
      },
    });
    const seededAuditIds = [auditLogin.id, auditSale1.id, auditSale2.id];
    const seededAuditUserIds = new Map(
      [auditLogin, auditSale1, auditSale2].map((a) => [a.id, a.userId]),
    );

    // -----------------------------------------------------------------
    // 2. Sichern.
    // -----------------------------------------------------------------
    const before = {
      orderCount: await prisma.order.count({ where: { eventId: event.id } }),
      orderItemCount: await prisma.orderItem.count({
        where: { order: { eventId: event.id } },
      }),
      paymentCount: await prisma.payment.count({
        where: { order: { eventId: event.id } },
      }),
      voucherCount: await prisma.productVoucher.count({
        where: { eventId: event.id },
      }),
      totalAmountSum: (
        await prisma.order.aggregate({
          where: { eventId: event.id },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount,
      paymentAmountSum: (
        await prisma.payment.aggregate({
          where: { order: { eventId: event.id } },
          _sum: { amount: true },
        })
      )._sum.amount,
    };

    // Hinweis: backupMeta.counts ist global über die gesamte Datenbank, nicht
    // auf diese Veranstaltung beschränkt — deshalb wird hier nicht auf einen
    // absoluten Wert geprüft. Der scoped-into-this-event-Vergleich folgt
    // unten über "before"/"after".
    const backupMeta = await backupService.createBackup(admin.id);

    // -----------------------------------------------------------------
    // Realistisches Zwischenszenario "neues Gerät, alte Sicherung":
    // die Sequenz wird künstlich zurückgesetzt, wie sie es auf einer frisch
    // aufgesetzten Datenbank wäre, deren höchste je vergebene Bestellnummer
    // niedriger ist als die in der Sicherung enthaltenen Werte.
    // -----------------------------------------------------------------
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Order"', 'orderNumber'), 1, false)`,
    );

    // Spion auf $transaction, um B9 (ausreichendes Zeitlimit) nachzuweisen,
    // ohne ein Datenvolumen zu brauchen, das die Voreinstellung von 5
    // Sekunden tatsächlich reißt.
    const transactionSpy = jest.spyOn(prisma, "$transaction");

    // -----------------------------------------------------------------
    // 3. Wiederherstellen.
    // -----------------------------------------------------------------
    const restoreOutcome = await backupService.restoreBackup(
      backupMeta.filename,
      admin.id,
    );
    expect(restoreOutcome.success).toBe(true);

    expect(transactionSpy).toHaveBeenCalled();
    const restoreCall = transactionSpy.mock.calls.find(
      (call) => typeof call[1]?.timeout === "number" && call[1]!.timeout > 5000,
    );
    expect(restoreCall).toBeDefined();
    transactionSpy.mockRestore();

    // -----------------------------------------------------------------
    // 4. Vergleichen.
    // -----------------------------------------------------------------
    const after = {
      orderCount: await prisma.order.count({ where: { eventId: event.id } }),
      orderItemCount: await prisma.orderItem.count({
        where: { order: { eventId: event.id } },
      }),
      paymentCount: await prisma.payment.count({
        where: { order: { eventId: event.id } },
      }),
      voucherCount: await prisma.productVoucher.count({
        where: { eventId: event.id },
      }),
      totalAmountSum: (
        await prisma.order.aggregate({
          where: { eventId: event.id },
          _sum: { totalAmount: true },
        })
      )._sum.totalAmount,
      paymentAmountSum: (
        await prisma.payment.aggregate({
          where: { order: { eventId: event.id } },
          _sum: { amount: true },
        })
      )._sum.amount,
    };

    expect(after).toEqual(before);
    expect(after.orderCount).toBe(2);
    expect(after.voucherCount).toBe(3);
    expect(after.totalAmountSum).toBe(1050);
    expect(after.paymentAmountSum).toBe(1050);

    // Auditurheber: kein Eintrag, der vorher einen Urheber hatte, darf nach
    // der Wiederherstellung ohne Urheber dastehen (B7).
    const restoredAuditRows = await prisma.auditLog.findMany({
      where: { id: { in: seededAuditIds } },
    });
    expect(restoredAuditRows).toHaveLength(seededAuditIds.length);
    for (const row of restoredAuditRows) {
      expect(row.userId).not.toBeNull();
      expect(row.userId).toBe(seededAuditUserIds.get(row.id));
    }

    // Fremdschlüsselintegrität: explizit nachgemessen, nicht nur unterstellt,
    // weil die Wiederherstellung nicht abgebrochen ist.
    const orphanedOrders = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "Order" o
       LEFT JOIN "User" u ON u.id = o."userId"
       WHERE u.id IS NULL`,
    );
    expect(Number(orphanedOrders[0].count)).toBe(0);

    const orphanedVouchers = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "ProductVoucher" v
       LEFT JOIN "Order" o ON o.id = v."orderId"
       LEFT JOIN "OrderItem" oi ON oi.id = v."orderItemId"
       WHERE o.id IS NULL OR oi.id IS NULL`,
    );
    expect(Number(orphanedVouchers[0].count)).toBe(0);

    const auditLogsWithDanglingUser = await prisma.$queryRawUnsafe<
      { count: bigint }[]
    >(
      `SELECT count(*)::bigint AS count FROM "AuditLog" a
       WHERE a."userId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."userId")`,
    );
    expect(Number(auditLogsWithDanglingUser[0].count)).toBe(0);

    // EventPickupCounter wurde nicht eingespielt (es steht nicht einmal in
    // der Sicherungsdatei), sondern aus MAX("pickupNumber") abgeleitet.
    const derivedCounter = await prisma.eventPickupCounter.findUnique({
      where: { eventId_dataMode: { eventId: event.id, dataMode: "LIVE" } },
    });
    expect(derivedCounter?.lastNumber).toBe(2);

    // -----------------------------------------------------------------
    // 5. Danach einen weiteren Verkauf buchen: freie Bestellnummer und
    //    freie Abholnummer beweisen, dass Sequenz und Zähler nachgesetzt
    //    wurden.
    // -----------------------------------------------------------------
    const saleResult = await ordersService.createQuickSale(cashier.id, {
      eventId: event.id,
      idempotencyKey: randomUUID(),
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "CASH",
      tenderedAmount: 350,
      stationId: station.id,
    } as any);

    expect(saleResult.pickupNumber).toBe(3);
    expect(saleResult.order.orderNumber).not.toBe(order1.orderNumber);
    expect(saleResult.order.orderNumber).not.toBe(order2.orderNumber);
    expect(saleResult.order.orderNumber).toBeGreaterThan(
      Math.max(order1.orderNumber, order2.orderNumber),
    );

    // Auch die Abholnummer darf keine der bereits vergebenen wiederholen —
    // das ist exakt der Fall, den B6/#100 offen ließen.
    const pickupCollisions = await prisma.order.count({
      where: {
        eventId: event.id,
        dataMode: "LIVE",
        pickupNumber: saleResult.pickupNumber,
        id: { not: saleResult.order.id },
      },
    });
    expect(pickupCollisions).toBe(0);
  }, 60_000);

  it("nimmt eine Wiederherstellung nicht zurück, wenn der handelnde Administrator nicht in der Sicherung enthalten ist (B8)", async () => {
    // Der Fall "neues Gerät, alte Sicherung": Die Sicherung wird auf einem
    // Gerät gezogen, dessen Benutzerbestand einen bestimmten Administrator
    // noch nicht kennt (er wird erst DANACH angelegt — etwa frisch auf einem
    // neu aufgesetzten Gerät). Der jetzt handelnde Administrator existiert in
    // der AKTUELLEN Datenbank (er ist angemeldet, die Sicherheitssicherung
    // gelingt also), aber tx.user.deleteMany()/createMany(data.users)
    // ersetzt den Benutzerbestand vollständig durch den der alten Sicherung
    // — und darin kommt er nicht vor. Vor der Korrektur schrieb die letzte
    // Anweisung der Transaktion einen Auditeintrag mit genau dieser fremden
    // Kennung und riss die bereits erfolgreiche Wiederherstellung per P2003
    // wieder zurück.
    const seedUser = await prisma.user.create({
      data: {
        username: `waechtertest-restore-seed-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    cleanupUserIds.push(seedUser.id);

    const event = await prisma.event.create({
      data: { name: `Wächtertest B8 ${randomUUID()}`, status: "DRAFT" },
    });
    cleanupEventIds.push(event.id);

    // Sicherung ziehen, BEVOR es den handelnden Administrator überhaupt gibt.
    const backupMeta = await backupService.createBackup(seedUser.id);

    const outsiderAdmin = await prisma.user.create({
      data: {
        username: `waechtertest-restore-outsider-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    cleanupUserIds.push(outsiderAdmin.id);

    const outcome = await backupService.restoreBackup(
      backupMeta.filename,
      outsiderAdmin.id,
    );
    expect(outcome.success).toBe(true);

    // Die Veranstaltung aus der Sicherung muss tatsächlich angekommen sein —
    // der Beweis, dass die Wiederherstellung nicht zurückgerollt wurde.
    const restoredEvent = await prisma.event.findUnique({
      where: { id: event.id },
    });
    expect(restoredEvent).not.toBeNull();

    // outsiderAdmin war nicht Teil der Sicherung und wurde durch das
    // Ersetzen des Benutzerbestands entfernt.
    const outsiderAfterRestore = await prisma.user.findUnique({
      where: { id: outsiderAdmin.id },
    });
    expect(outsiderAfterRestore).toBeNull();

    const restoreAudit = await prisma.auditLog.findFirst({
      where: { action: "RESTORE_BACKUP", entityId: backupMeta.filename },
      orderBy: { createdAt: "desc" },
    });
    expect(restoreAudit).not.toBeNull();
    expect(restoreAudit?.userId).toBeNull();
    expect((restoreAudit?.details as any)?.calledByUserId).toBe(
      outsiderAdmin.id,
    );

    // outsiderAdmin nicht erneut über cleanupUserIds löschen — existiert
    // nach der Wiederherstellung nicht mehr.
    cleanupUserIds.pop();
  }, 30_000);

  it("setzt nach ausdrücklich wiederhergestellten Bestellnummern die Sequenz auf die nächste freie Nummer (Issue #102)", async () => {
    const user = await prisma.user.create({
      data: {
        username: `waechtertest-bestellnummer-restore-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    cleanupUserIds.push(user.id);

    const event = await prisma.event.create({
      data: { name: `Wächtertest Bestellnummer-Restore ${randomUUID()}` },
    });
    cleanupEventIds.push(event.id);

    // Ein Wert oberhalb des momentanen Datenbankmaximums beweist, dass der
    // folgende automatische Insert nur dann korrekt ist, wenn restoreBackup
    // die PostgreSQL-Sequenz tatsächlich nachsetzt.
    const maximum = await prisma.order.aggregate({
      _max: { orderNumber: true },
    });
    const restoredOrderNumber = (maximum._max.orderNumber ?? 0) + 100;
    await prisma.order.create({
      data: {
        eventId: event.id,
        userId: user.id,
        dataMode: "LIVE",
        totalAmount: 350,
        orderNumber: restoredOrderNumber,
      },
    });

    const backup = await backupService.createBackup(user.id);

    // Ein Restore auf einem frisch aufgesetzten Gerät hat genau diesen
    // Sequenzzustand: Die Daten enthalten hohe, explizit geschriebene Nummern,
    // die lokale SERIAL-Sequenz weiß davon aber noch nichts. setval(..., false)
    // macht den nächsten nextval sicher zu 1, ohne Daten außerhalb der durch
    // assertTestDatabaseUrl geprüften Wegwerfdatenbank anzufassen.
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('"Order"', 'orderNumber'),
        1,
        false
      )
    `);

    await expect(
      backupService.restoreBackup(backup.filename, user.id),
    ).resolves.toMatchObject({ success: true });

    const subsequentOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: user.id,
        dataMode: "LIVE",
        totalAmount: 700,
      },
    });
    expect(subsequentOrder.orderNumber).toBe(restoredOrderNumber + 1);
  }, 30_000);

  // Issue #165: Sicherheitsnetz für die drei neuen Fachprüfungen in
  // backup-document.ts (CashierSession.status, Payment-Tenderregel,
  // Order.paymentStatus). Eine Sicherung, die das System selbst aus einem
  // realistischen Bestand erzeugt, muss diese Prüfungen immer bestehen -
  // dieser Test ist der Nachweis dafür, nicht nur ein weiterer Regressions-
  // schutz. Der Bestand enthält bewusst alle in Issue #165 genannten
  // schwierigen Fälle: eine Barzahlung mit Wechselgeld, eine Kartenzahlung,
  // eine Teilzahlung, eine Rückerstattung (Pfandauszahlung über dem
  // Bestellwert), eine geschlossene und eine offene Kassensitzung sowie eine
  // stornierte Bestellung.
  it("akzeptiert und übernimmt eine realistische Sicherung mit Bar-, Karten-, Teil- und Rückerstattungszahlungen, offener/geschlossener Kassensitzung und einer stornierten Bestellung (Issue #165)", async () => {
    const admin = await prisma.user.create({
      data: {
        username: `waechtertest-165-admin-${randomUUID()}`,
        pinHash: "x",
        role: "ADMINISTRATOR",
      },
    });
    const cashier = await prisma.user.create({
      data: {
        username: `waechtertest-165-cashier-${randomUUID()}`,
        pinHash: "x",
        role: "CASHIER",
      },
    });
    cleanupUserIds.push(admin.id, cashier.id);

    const event = await prisma.event.create({
      data: {
        name: `Wächtertest Issue 165 ${randomUUID()}`,
        status: "ACTIVE",
        testMode: false,
      },
    });
    cleanupEventIds.push(event.id);

    const category = await prisma.productCategory.create({
      data: { name: "Getränke", eventId: event.id },
    });
    const product = await prisma.product.create({
      data: {
        name: "Bier",
        price: 500,
        eventId: event.id,
        categoryId: category.id,
      },
    });

    // Geschlossene Kassensitzung: status, closingBalance und endTime wurden
    // gemeinsam von closeSession gesetzt (sessions.service.ts).
    const closedSession = await prisma.cashierSession.create({
      data: {
        userId: cashier.id,
        eventId: event.id,
        dataMode: "LIVE",
        status: "CLOSED",
        startingBalance: 10000,
        closingBalance: 15000,
        endTime: new Date(),
      },
    });
    // Offene Kassensitzung: startSession hat weder closingBalance noch
    // endTime je gesetzt.
    const openSession = await prisma.cashierSession.create({
      data: {
        userId: cashier.id,
        eventId: event.id,
        dataMode: "LIVE",
        status: "ACTIVE",
        startingBalance: 5000,
      },
    });

    // 1. Barzahlung mit Wechselgeld (Bon-/Stationskasse: tenderedAmount und
    // changeAmount vollständig belegt).
    const cashOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 1000,
        paymentStatus: "PAID",
        cashierSessionId: closedSession.id,
        items: {
          create: [{ productId: product.id, quantity: 2, priceAtTime: 500 }],
        },
        payments: {
          create: [
            {
              amount: 1000,
              method: "CASH",
              tenderedAmount: 1200,
              changeAmount: 200,
              status: "COMPLETED",
              cashierSessionId: closedSession.id,
            },
          ],
        },
      },
    });

    // 2. Kartenzahlung (tenderedAmount/changeAmount bleiben leer bzw. 0).
    const cardOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 500,
        paymentStatus: "PAID",
        cashierSessionId: closedSession.id,
        items: {
          create: [{ productId: product.id, quantity: 1, priceAtTime: 500 }],
        },
        payments: {
          create: [
            {
              amount: 500,
              method: "CARD",
              status: "COMPLETED",
              cashierSessionId: closedSession.id,
            },
          ],
        },
      },
    });

    // 3. Teilzahlung (Splitzahlung über addPaymentsToOrder/
    // splitPaymentOrder: CASH ohne Bargeldbeleg, Summe bleibt unter
    // totalAmount).
    const partialOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 900,
        paymentStatus: "PARTIALLY_PAID",
        cashierSessionId: openSession.id,
        items: {
          create: [{ productId: product.id, quantity: 1, priceAtTime: 900 }],
        },
        payments: {
          create: [
            {
              amount: 400,
              method: "CASH",
              status: "COMPLETED",
              cashierSessionId: openSession.id,
            },
          ],
        },
      },
    });

    // 4. Rückerstattung: Pfandauszahlung über dem Bestellwert, wie sie
    // createQuickSale/createStationSale erzeugen (CASH deckt totalAmount,
    // REFUND zahlt den Überhang bar aus).
    const refundOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 300,
        paymentStatus: "PAID",
        cashierSessionId: closedSession.id,
        payments: {
          create: [
            {
              amount: 300,
              method: "CASH",
              tenderedAmount: 300,
              changeAmount: 0,
              status: "COMPLETED",
              cashierSessionId: closedSession.id,
            },
            {
              amount: 150,
              method: "REFUND",
              status: "COMPLETED",
              cashierSessionId: closedSession.id,
            },
          ],
        },
      },
    });

    // 5. Stornierte Bestellung: cancelOrder ändert lifecycleStatus, lässt
    // paymentStatus aber unberührt - PAID bleibt PAID.
    const cancelledOrder = await prisma.order.create({
      data: {
        eventId: event.id,
        userId: cashier.id,
        dataMode: "LIVE",
        totalAmount: 500,
        paymentStatus: "PAID",
        lifecycleStatus: "CANCELLED",
        cashierSessionId: closedSession.id,
        payments: {
          create: [
            {
              amount: 500,
              method: "CARD",
              status: "COMPLETED",
              cashierSessionId: closedSession.id,
            },
          ],
        },
      },
    });

    const backup = await backupService.createBackup(admin.id);

    // Der eigentliche Nachweis: das System-eigene Backup darf an den drei
    // neuen Prüfungen niemals scheitern.
    await expect(
      backupService.restoreBackup(backup.filename, admin.id),
    ).resolves.toMatchObject({ success: true });

    const [
      restoredClosedSession,
      restoredOpenSession,
      restoredCashOrder,
      restoredCardOrder,
      restoredPartialOrder,
      restoredRefundOrder,
      restoredCancelledOrder,
    ] = await Promise.all([
      prisma.cashierSession.findUnique({ where: { id: closedSession.id } }),
      prisma.cashierSession.findUnique({ where: { id: openSession.id } }),
      prisma.order.findUnique({
        where: { id: cashOrder.id },
        include: { payments: true },
      }),
      prisma.order.findUnique({
        where: { id: cardOrder.id },
        include: { payments: true },
      }),
      prisma.order.findUnique({
        where: { id: partialOrder.id },
        include: { payments: true },
      }),
      prisma.order.findUnique({
        where: { id: refundOrder.id },
        include: { payments: true },
      }),
      prisma.order.findUnique({ where: { id: cancelledOrder.id } }),
    ]);

    expect(restoredClosedSession).toMatchObject({
      status: "CLOSED",
      closingBalance: 15000,
    });
    expect(restoredClosedSession?.endTime).not.toBeNull();
    expect(restoredOpenSession).toMatchObject({
      status: "ACTIVE",
      closingBalance: null,
      endTime: null,
    });

    expect(restoredCashOrder?.paymentStatus).toBe("PAID");
    expect(restoredCashOrder?.payments).toMatchObject([
      { method: "CASH", tenderedAmount: 1200, changeAmount: 200 },
    ]);

    expect(restoredCardOrder?.paymentStatus).toBe("PAID");
    expect(restoredCardOrder?.payments).toMatchObject([
      { method: "CARD", tenderedAmount: null, changeAmount: 0 },
    ]);

    expect(restoredPartialOrder?.paymentStatus).toBe("PARTIALLY_PAID");
    expect(restoredPartialOrder?.payments).toMatchObject([
      { method: "CASH", tenderedAmount: null, changeAmount: 0, amount: 400 },
    ]);

    expect(restoredRefundOrder?.paymentStatus).toBe("PAID");
    expect(restoredRefundOrder?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "CASH", amount: 300 }),
        expect.objectContaining({ method: "REFUND", amount: 150 }),
      ]),
    );

    expect(restoredCancelledOrder).toMatchObject({
      lifecycleStatus: "CANCELLED",
      paymentStatus: "PAID",
    });
  }, 30_000);
});
