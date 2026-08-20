import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';
const POLL_INTERVAL_MS = 2500;

interface PrintJob {
  id: string;
  jobType: 'STATION_TICKET' | 'PRODUCT_VOUCHER' | 'RECEIPT' | 'CASHIER_CLOSING';
  printer: {
    id: string;
    name: string;
    type: string;
  };
  content: any;
  createdAt: string;
}

class FormattedTicketPrinter {
  formatCurrency(cents: number) {
    return `€ ${(cents / 100).toFixed(2)}`;
  }

  formatDate(isoStr: string) {
    const d = new Date(isoStr);
    return d.toLocaleString('de-AT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  async print(job: PrintJob) {
    const { jobType, printer, content } = job;

    console.log(`\n======================================================`);
    console.log(`🖨️  DRUCKER: [${printer.name}]  |  TYP: [${jobType}]`);
    console.log(`======================================================`);

    switch (jobType) {
      case 'STATION_TICKET':
        console.log(`📋 ${content.title || 'ABHOL-/KÜCHENBON'}: ${content.stationName}`);
        console.log(`------------------------------------------------------`);
        console.log(`Bestellung:      #${content.orderNumber || content.orderId}${content.isPriority ? '  ⭐ [PRIORITÄT / EILT!]' : ''}`);
        console.log(`Tisch / Bereich: ${content.tableName}`);
        console.log(`Bedienung:       ${content.waiterName}`);
        console.log(`Zeitpunkt:       ${this.formatDate(content.createdAt || job.createdAt)}`);
        console.log(`------------------------------------------------------`);
        console.log(`POSITIONEN:`);
        for (const item of content.items || []) {
          console.log(`  ▶  ${item.quantity}x  ${item.productName}`);
          if (item.variantName) {
            console.log(`       • ${item.variantName}`);
          }
          if (item.extras && item.extras.length > 0) {
            for (const ext of item.extras) {
              console.log(`       + ${ext.name}`);
            }
          }
        }
        break;

      case 'RECEIPT':
        console.log(`🧾 ${content.title || 'KASSENBELEG'} - ${content.eventName || 'Vereinsfest'}`);
        console.log(`------------------------------------------------------`);
        console.log(`Bestellung:      #${content.orderNumber || content.orderId}`);
        console.log(`Tisch / Bereich: ${content.tableName}`);
        console.log(`Bedienung:       ${content.waiterName}`);
        console.log(`Datum / Uhrzeit: ${this.formatDate(content.createdAt || job.createdAt)}`);
        console.log(`------------------------------------------------------`);
        for (const item of content.items || []) {
          const itemLine = `  ${item.quantity}x ${item.productName}`;
          const priceLine = `${this.formatCurrency(item.totalPrice || (item.price * item.quantity))}`;
          const dots = '.'.repeat(Math.max(2, 45 - itemLine.length - priceLine.length));
          console.log(`${itemLine} ${dots} ${priceLine}`);
          if (item.variantName) {
            console.log(`     • ${item.variantName}`);
          }
        }
        console.log(`------------------------------------------------------`);
        console.log(`GESAMTBETRAG:    ${this.formatCurrency(content.totalAmount)}`);
        
        if (content.payments && content.payments.length > 0) {
          for (const p of content.payments) {
            const methodLabel = p.method === 'CASH' ? 'Bar' : p.method === 'CARD' ? 'Karte' : 'Gutschein';
            console.log(`Zahlung (${methodLabel}): ${this.formatCurrency(p.amount)}`);
          }
        }
        if (content.changeAmount && content.changeAmount > 0) {
          console.log(`RÜCKGELD:        ${this.formatCurrency(content.changeAmount)}`);
        }
        console.log(`------------------------------------------------------`);
        console.log(`Hinweis: ${content.rksvDisclaimer || 'VereinOrder ist keine RKSV-Registrierkasse.'}`);
        console.log(`Vielen Dank für Ihre Unterstützung!`);
        break;

      case 'PRODUCT_VOUCHER':
        console.log(`🎟️ ${content.title || 'PRODUKTBON'}`);
        console.log(`------------------------------------------------------`);
        console.log(`Bestellung: #${content.orderNumber}  |  Tisch: ${content.tableName}`);
        console.log(`------------------------------------------------------`);
        console.log(`  ▶  ${content.quantity}x ${content.productName}`);
        if (content.variantName) console.log(`     • ${content.variantName}`);
        console.log(`------------------------------------------------------`);
        console.log(`Ausgabe an: ${content.stationName || 'Zentral'}`);
        break;

      default:
        console.log(JSON.stringify(content, null, 2));
        break;
    }

    console.log(`======================================================\n`);

    // Simulate thermal printing time
    await new Promise(resolve => setTimeout(resolve, 800));
  }
}

async function fetchPendingJobs(): Promise<PrintJob[]> {
  try {
    const res = await axios.get(`${BACKEND_URL}/print-jobs`);
    return res.data;
  } catch (err: any) {
    console.error(`[Worker] Fehler beim Abrufen der Print-Jobs: ${err.message}`);
    return [];
  }
}

async function markJobAsPrinted(id: string) {
  try {
    await axios.patch(`${BACKEND_URL}/print-jobs/${id}/status`, { status: 'PRINTED' });
    console.log(`[Worker] Job ${id} erfolgreich gedruckt & als PRINTED markiert.`);
  } catch (err: any) {
    console.error(`[Worker] Fehler beim Aktualisieren des Status für Job ${id}: ${err.message}`);
  }
}

async function main() {
  console.log(`[Worker] VereinOrder Print-Worker gestartet.`);
  console.log(`[Worker] Abfrage-Intervall: ${POLL_INTERVAL_MS}ms auf ${BACKEND_URL}`);
  
  const printer = new FormattedTicketPrinter();

  setInterval(async () => {
    const jobs = await fetchPendingJobs();
    if (jobs.length > 0) {
      console.log(`[Worker] ${jobs.length} neue(n) Druckauftrag/aufträge gefunden.`);
    }

    for (const job of jobs) {
      try {
        await printer.print(job);
        await markJobAsPrinted(job.id);
      } catch (err: any) {
        console.error(`[Worker] Fehler beim Verarbeiten von Job ${job.id}:`, err);
        try {
          await axios.patch(`${BACKEND_URL}/print-jobs/${job.id}/status`, { 
            status: 'FAILED', 
            errorMessage: err.message 
          });
        } catch (e) {
          // ignore
        }
      }
    }
  }, POLL_INTERVAL_MS);
}

main().catch(console.error);
