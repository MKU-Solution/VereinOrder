import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminUsersView } from "./AdminUsersView";

describe("AdminUsersView", () => {
  const mockUsers = [
    {
      id: "usr-1",
      username: "kellner1",
      role: "WAITER",
      isActive: true,
    },
    {
      id: "usr-2",
      username: "admin",
      role: "ADMINISTRATOR",
      isActive: true,
    },
    {
      id: "usr-3",
      username: "altkellner",
      role: "WAITER",
      isActive: false,
    },
  ];

  it("rendert Benutzer mit Rollen- und Status-Badges", () => {
    render(
      <AdminUsersView
        users={mockUsers}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByText("kellner1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("altkellner").length).toBeGreaterThan(0);

    const roleFilter = screen.getByRole("combobox", {
      name: "Rolle filtern",
    });
    fireEvent.change(roleFilter, { target: { value: "ADMINISTRATOR" } });

    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.queryByText("kellner1")).not.toBeInTheDocument();
  });

  it("filtert nach Aktivitätsstatus", () => {
    render(
      <AdminUsersView
        users={mockUsers}
        onRefresh={vi.fn()}
        onOpenCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const statusFilter = screen.getByRole("combobox", {
      name: "Status filtern",
    });
    fireEvent.change(statusFilter, { target: { value: "INACTIVE" } });

    expect(screen.getAllByText("altkellner").length).toBeGreaterThan(0);
    expect(screen.queryByText("kellner1")).not.toBeInTheDocument();
  });
});
