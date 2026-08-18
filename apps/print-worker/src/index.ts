import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';
const POLL_INTERVAL_MS = 3000;

interface PrintJob {
  id: string;
  printer: {
    id: string;
    name: string;
    type: string;
  };
  content: any;
}

class ConsolePrinter {
  async print(job: PrintJob) {
    console.log(`\n=================================================`);
    console.log(`🖨️  DRUCKAUFTRAG: ${job.printer.name}`);
    console.log(`=================================================`);
    console.log(`Bestellung #${job.content.orderNumber}`);
    console.log(`-------------------------------------------------`);
    for (const item of job.content.items) {
      console.log(`${item.quantity}x ${item.productName} \t € ${(item.price / 100).toFixed(2)}`);
    }
    console.log(`-------------------------------------------------`);
    console.log(`GESAMT: \t\t € ${(job.content.totalAmount / 100).toFixed(2)}`);
    console.log(`=================================================\n`);
    
    // Simulate printing time
    await new Promise(resolve => setTimeout(resolve, 1000));
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
    console.log(`[Worker] Job ${id} erfolgreich als PRINTED markiert.`);
  } catch (err: any) {
    console.error(`[Worker] Fehler beim Aktualisieren des Status für Job ${id}: ${err.message}`);
  }
}

async function main() {
  console.log(`[Worker] Print-Worker gestartet. Frage ${BACKEND_URL} alle ${POLL_INTERVAL_MS}ms ab...`);
  const printer = new ConsolePrinter();

  setInterval(async () => {
    const jobs = await fetchPendingJobs();
    if (jobs.length > 0) {
      console.log(`[Worker] ${jobs.length} neue(n) Druckauftrag/aufträge gefunden.`);
    }

    for (const job of jobs) {
      try {
        if (job.printer.type === 'CONSOLE') {
          await printer.print(job);
          await markJobAsPrinted(job.id);
        } else {
          console.warn(`[Worker] Unbekannter Druckertyp ${job.printer.type} für Job ${job.id}`);
          // Mark as failed
          await axios.patch(`${BACKEND_URL}/print-jobs/${job.id}/status`, { status: 'FAILED', errorMessage: 'Unsupported printer type' });
        }
      } catch (err) {
        console.error(`[Worker] Fehler beim Verarbeiten von Job ${job.id}:`, err);
      }
    }
  }, POLL_INTERVAL_MS);
}

main().catch(console.error);
