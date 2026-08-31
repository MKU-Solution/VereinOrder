import { Body, Controller, Get, Post } from "@nestjs/common";
import { SetupService } from "./setup.service";
import { CreateSetupAdminDto, SetupStatus } from "./setup.dto";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";

/**
 * Ersteinrichtung (Issue #173). Beide Wege tragen bewusst KEINEN
 * `JwtAuthGuard`: Sie existieren fuer den Zustand, in dem es noch keinen
 * Benutzer gibt, fuer den ein Token ausgestellt werden koennte. Ihre einzige
 * Schranke ist "die Benutzertabelle ist leer" - geprueft im Backend, in
 * `SetupService`, innerhalb einer SERIALIZABLE-Transaktion.
 *
 * ## Entscheidung: `@MaintenancePublic()` auf Klassenebene, also JA
 *
 * Der Wartungsguard laeuft als `APP_GUARD` vor jedem controllergebundenen
 * Guard (`maintenance.module.ts`). Ohne diese Markierung waeren beide Wege
 * gesperrt, sobald `MaintenanceStateService.read()` nicht OPEN liefert. Drei
 * Ueberlegungen, in dieser Reihenfolge:
 *
 * 1. **Sonst gibt es aus LOCKED auf einem frischen System keinen Weg
 *    heraus.** Auf einem frisch migrierten System fehlt die Zustandsdatei,
 *    `read()` liefert OPEN, und die Ersteinrichtung ist ohnehin offen. Ist
 *    die Datei dagegen beschaedigt - abgeschnitten, weil die Platte beim
 *    ersten Schreiben voll war, oder halb geschrieben nach einem
 *    Stromausfall -, liefert `read()` mit voller Absicht LOCKED. Der einzige
 *    Ausstieg aus LOCKED ueber die Anwendung ist `POST /maintenance/end`,
 *    und der verlangt ein ADMINISTRATOR-Token, das ohne Benutzer nicht
 *    existieren kann. Ohne diese Ausnahme braechte eine kaputte Datei im
 *    Zustandsvolume die Installation in eine Lage, aus der nur noch ein
 *    Eingriff auf der Serverkonsole herausfuehrt - genau die Konsolenarbeit,
 *    die #177 abschaffen soll. Es ist derselbe Grund, aus dem
 *    `POST /maintenance/end` und `POST /auth/login` bereits ausgenommen sind:
 *    eine Sperre, die ihren eigenen Ausstieg mitsperrt, ist eine Falle.
 *
 * 2. **Die Ausnahme kostet nichts, weil die eigene Schranke enger ist als
 *    die Wartungssperre.** Auf jedem System, das die Ersteinrichtung einmal
 *    durchlaufen hat, sind beide Wege wirkungslos: `GET /setup/status`
 *    meldet konstant `false`, `POST /setup/admin` weist konstant ab. Die
 *    Wartungssperre wuerde hier nichts schuetzen, was nicht schon geschuetzt
 *    waere.
 *
 * 3. **Das Fenster, das LOCKED schuetzen soll, zeigt nie eine leere
 *    Benutzertabelle.** Bei einer Wiederherstellung aus JSON loescht und
 *    schreibt `BackupService.restoreFromJson` die Benutzer innerhalb EINER
 *    Transaktion (`backup.service.ts`, `tx.user.deleteMany()` unmittelbar
 *    gefolgt von `tx.user.createMany(...)`); eine gleichzeitige Zaehlung
 *    sieht entweder den alten oder den neuen Stand, nie einen leeren. Die
 *    native Wiederherstellung tauscht ganze Datenbanken per Umbenennung
 *    (`restore-swap.ts`) und trennt dabei die Verbindungen - auch dort
 *    entsteht kein Augenblick, in dem die laufende Datenbank existiert und
 *    keine Benutzer hat. Ein Zugriff waehrend des Tausches scheitert an der
 *    Datenbank und meldet einen Fehler; er meldet insbesondere NICHT
 *    faelschlich "Ersteinrichtung steht aus", weil `SetupService.getStatus`
 *    den Fehler durchreicht, statt ersatzweise `true` zu antworten.
 *
 * Restrisiko, das diese Ausnahme NICHT abdeckt und das aus #177 bewusst
 * uebernommen ist: Zwischen erstem Start und abgeschlossener Ersteinrichtung
 * wird derjenige Administrator, der zuerst zugreift. Dagegen hilft kein
 * Guard, sondern nur die Reihenfolge im Betrieb (Ersteinrichtung vor dem
 * Oeffnen des Netzes, siehe #176).
 */
@MaintenancePublic()
@Controller("setup")
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get("status")
  async getStatus(): Promise<SetupStatus> {
    return this.setupService.getStatus();
  }

  /**
   * Antwortet mit dem angelegten Konto ohne PIN-Hash, damit die Oberflaeche
   * (#174) unmittelbar danach `POST /auth/login` mit den eben vergebenen
   * Daten aufrufen kann. Ein Token wird hier NICHT ausgestellt: Die Anmeldung
   * bleibt der eine Weg, auf dem Token entstehen, samt Fehlversuchszaehler
   * und Auditeintrag - dieser Weg legt ein Konto an, mehr nicht.
   */
  @Post("admin")
  async createAdministrator(@Body() body: CreateSetupAdminDto) {
    return this.setupService.createFirstAdministrator(body);
  }
}
