// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

afterEach(cleanup);

function SheetExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open settings</Button>
      <Sheet open={open} title="Settings" onClose={() => setOpen(false)}>
        <Button>Save settings</Button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("moves focus inside when opened and restores focus when closed", async () => {
    const user = userEvent.setup();
    render(<SheetExample />);
    const trigger = screen.getByRole("button", { name: "Open settings" });

    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Save settings" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not close on Escape while an operation is committing", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Sheet open title="Deleting" onClose={onClose} isCommitting>
        <Button>Working</Button>
      </Sheet>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
