import { RestoreProcessRestartService } from "./restore-process-restart.service";

describe("kontrollierter Prozessneustart nach Restore (Issue #67)", () => {
  const previous = process.env.RESTORE_EXIT_AFTER_SWAP;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.RESTORE_EXIT_AFTER_SWAP;
    else process.env.RESTORE_EXIT_AFTER_SWAP = previous;
  });

  it("ist außerhalb des Compose-Festbetriebs deaktiviert", () => {
    delete process.env.RESTORE_EXIT_AFTER_SWAP;
    expect(new RestoreProcessRestartService().schedule()).toBe(false);
  });

  it("beendet den Prozess verzögert, damit die HTTP-Antwort ausgeliefert werden kann", () => {
    jest.useFakeTimers();
    process.env.RESTORE_EXIT_AFTER_SWAP = "1";
    const exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    expect(new RestoreProcessRestartService().schedule()).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_500);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
