import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineQueueIndicator } from "./OfflineQueueIndicator";

// Deckt Issue #65 ab: ein dauerhaft sichtbarer Hinweis auf Verbindungszustand
// und Anzahl offener Vormerkungen, der nie mit einer bestätigten Bestellung
// verwechselbar ist (eigener Wortlaut "vorgemerkt").

describe("OfflineQueueIndicator – Anzeige der Anzahl offener Vormerkungen", () => {
  it("zeigt online ohne offene Einträge ohne Zähler", () => {
    render(
      <OfflineQueueIndicator openCount={0} isOnline={true} onOpen={vi.fn()} />,
    );

    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText(/vorgemerkt/)).not.toBeInTheDocument();
  });

  it("zeigt die Anzahl offener Vormerkungen als eigenen Wortlaut, nie als bestätigt oder gesendet", () => {
    render(
      <OfflineQueueIndicator openCount={3} isOnline={true} onOpen={vi.fn()} />,
    );

    expect(screen.getByText("3 vorgemerkt")).toBeInTheDocument();
    expect(screen.queryByText(/bestätigt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gesendet/)).not.toBeInTheDocument();
  });

  it("zeigt den Offline-Zustand nicht nur farblich, sondern auch als Text und im aria-label", () => {
    render(
      <OfflineQueueIndicator openCount={2} isOnline={false} onOpen={vi.fn()} />,
    );

    expect(screen.getByText("Offline")).toBeInTheDocument();
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toMatch(/Offline/);
    expect(button.getAttribute("aria-label")).toMatch(
      /2 lokal vorgemerkte Bestellungen/,
    );
  });

  it("ist mindestens 44px hoch (Bedienelement-Mindestgröße) und per Klick bedienbar", () => {
    const onOpen = vi.fn();
    render(
      <OfflineQueueIndicator openCount={1} isOnline={true} onOpen={onOpen} />,
    );

    const button = screen.getByRole("button");
    expect(button.className).toMatch(/min-h-11/);

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("verwendet die Einzahl korrekt bei genau einer Vormerkung", () => {
    render(
      <OfflineQueueIndicator openCount={1} isOnline={true} onOpen={vi.fn()} />,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toMatch(
      /1 lokal vorgemerkte Bestellung,/,
    );
  });
});
