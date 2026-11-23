import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Every chart here plots one series in --chart-1: the validated categorical blue, with its own
// light and dark steps (checked for >=3:1 contrast on both card surfaces).
const config = (label: string) => ({ n: { label, color: "var(--chart-1)" } }) satisfies ChartConfig;

function Frame({ caption, table, children }: { caption: string; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode }) {
  const [view, setView] = useState("chart");
  return (
    <figure>
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{caption}</span>
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="h-7">
            <TabsTrigger value="chart" className="px-2 text-xs">Chart</TabsTrigger>
            <TabsTrigger value="table" className="px-2 text-xs">Table</TabsTrigger>
          </TabsList>
        </Tabs>
      </figcaption>
      {view === "table" ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0"><TableRow>{table.head.map((h, i) => <TableHead key={h || i} className={i ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{table.rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={j ? "text-right tabular-nums" : ""}>{c}</TableCell>)}</TableRow>)}</TableBody>
          </Table>
        </div>
      ) : children}
    </figure>
  );
}

export function DailyBars({ data, label }: { data: { day: string; n: number }[]; label: string }) {
  const rows = data.map((d) => ({ ...d, label: format(new Date(`${d.day}T00:00:00`), "d MMM") }));
  const total = data.reduce((s, d) => s + d.n, 0);
  return (
    <Frame caption={`${total} ${label.toLowerCase()} in this period`} table={{ head: ["Day", label], rows: rows.map((r) => [r.label, r.n]) }}>
      <ChartContainer config={config(label)} className="aspect-auto h-56 w-full">
        <BarChart data={rows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="n" fill="var(--color-n)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

export function CategoryBars({ data, label, caption, horizontal }: { data: { name: string; n: number }[]; label: string; caption: string; horizontal?: boolean }) {
  return (
    <Frame caption={caption} table={{ head: ["", label], rows: data.map((d) => [d.name, d.n]) }}>
      <ChartContainer config={config(label)} className="aspect-auto h-56 w-full">
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={6} accessibilityLayer>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={84} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="n" fill="var(--color-n)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="20%" accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="n" fill="var(--color-n)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        )}
      </ChartContainer>
    </Frame>
  );
}
