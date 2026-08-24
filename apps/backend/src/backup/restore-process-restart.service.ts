import { Injectable } from "@nestjs/common";

@Injectable()
export class RestoreProcessRestartService {
  schedule(): boolean {
    if (process.env.RESTORE_EXIT_AFTER_SWAP !== "1") return false;
    const timer = setTimeout(() => process.exit(0), 1_500);
    timer.unref();
    return true;
  }
}
