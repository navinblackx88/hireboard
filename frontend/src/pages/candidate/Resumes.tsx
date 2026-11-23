import { useState } from "react";
import { Download, Eye, FileText, Star, Trash2 } from "lucide-react";
import { openFile, useResumeMutations, useResumes } from "@/hooks/api";
import { api } from "@/lib/api";
import { bytes, fmtDate } from "@/lib/format";
import type { Resume } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileIcon, ResumeDropzone } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, PageSpinner, confirmAction } from "@/components/common";

function IconAction({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className={className}>{children}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Resumes() {
  const { data, isLoading } = useResumes();
  const m = useResumeMutations();
  const [preview, setPreview] = useState<(Resume & { extractedText?: string }) | null>(null);

  return (
    <Page title="Resumes" subtitle="Upload a PDF or Word file. We extract the text once and send it with your applications.">
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <section>
          {isLoading ? <PageSpinner /> : !data?.length ? <EmptyState icon={<FileText />} title="No resumes yet" body="Add one to start applying." /> : (
            <ul className="space-y-3">
              {data.map((r) => (
                <li key={r.id}>
                  <Card className="flex-row flex-wrap items-center gap-3 p-4">
                    <FileIcon />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate font-medium">{r.filename}{r.isDefault && <Badge variant="secondary" className="bg-primary/10 text-primary">Default</Badge>}</p>
                      <p className="text-muted-foreground text-xs">{r.mimeType.includes("pdf") ? "PDF" : "Word"} · {bytes(r.sizeBytes)}{r.pageCount ? ` · ${r.pageCount} page${r.pageCount > 1 ? "s" : ""}` : ""} · {r.textLength.toLocaleString()} characters read · uploaded {fmtDate(r.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconAction label="Preview extracted text" onClick={async () => setPreview(await api(`/resumes/${r.id}`))}><Eye /></IconAction>
                      <IconAction label="Download" onClick={() => openFile(`/resumes/${r.id}/download`)}><Download /></IconAction>
                      {!r.isDefault && <IconAction label="Make default" onClick={() => m.makeDefault.mutate(r.id)}><Star /></IconAction>}
                      <IconAction label="Delete" className="hover:text-destructive"
                        onClick={async () => (await confirmAction({ title: `Delete ${r.filename}?`, description: "Employers you've already applied to keep their copy.", confirmLabel: "Delete", destructive: true })) && m.remove.mutate(r.id)}>
                        <Trash2 />
                      </IconAction>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside><ResumeDropzone busy={m.upload.isPending} onFile={(f) => m.upload.mutate(f)} /></aside>
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{preview?.filename}</DialogTitle>
            <DialogDescription>This is the text employers' screening sees. If something important is missing, try exporting your resume again as a text-based PDF.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="bg-muted h-[55vh] rounded-md border">
            <pre className="p-4 font-sans text-sm whitespace-pre-wrap">{preview?.extractedText}</pre>
          </ScrollArea>
          <DialogFooter><Button variant="outline" onClick={() => setPreview(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
