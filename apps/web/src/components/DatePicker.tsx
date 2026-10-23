import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@web/components/ui/button.tsx";
import { Calendar } from "@web/components/ui/calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@web/components/ui/popover.tsx";
import { cn, formatDate } from "@web/lib/utils.ts";

const toDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d);
};

const toValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** A `YYYY-MM-DD` date chosen from a calendar popover. */
export function DatePicker({
  id,
  value,
  onChange,
  max,
  className,
}: {
  id?: string;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className={cn("w-full justify-start font-normal", className)}>
          <CalendarIcon className="text-muted-foreground" />
          {formatDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          selected={toDate(value)}
          max={max ? toDate(max) : undefined}
          onSelect={(date) => {
            onChange(toValue(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
