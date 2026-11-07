"use client";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Icon name="print" className="size-5" /> Print
    </Button>
  );
}
