import { ArrowUpTray } from "@medusajs/icons";
import { Button, Container, Input, StatusBadge, Table, Text, toast } from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { CardError, CardSkeleton, EditDrawer, FormField, SectionHeader, humanize, inr, when } from "../../../components/kit";
import { opsFetch } from "../../../lib/ops";
import { parseRemittanceCsv, type CsvRow } from "../../../../modules/remittance/csv";

/**
 * Siumora › COD remittances (plan 16 Phase E) — the courier's COD payouts
 * matched against the orders they pay for: batches, the exceptions that
 * need a person (short payments, unknown orders, weight disputes), and the
 * cash position. "Record a remittance file" (plan 16 Phase H) reads the
 * courier's CSV in the browser, previews the totals, and posts the batch;
 * a batch already recorded replays as a no-op. Reached from the Siumora
 * home's menu.
 */

interface Batch {
  batchId: string;
  courier: string | null;
  rows: number;
  collected: number;
  deductions: number;
  remitted: number;
  shortfall: number;
  exceptions: number;
  reconciledAt: string | null;
}

interface Exception {
  id: string;
  batchId: string;
  orderNumber: string | null;
  outcome?: string;
  variance?: number;
  excessWeightGrams?: number | null;
  reconciledAt: string | null;
}

interface Desk {
  batches: Batch[];
  exceptions: Exception[];
  cash: { prepaidSettled: number; codInTransit: number; codAwaitingRemittance: number; codRemitted: number };
}

interface IngestReport {
  recorded: number;
  replayed: boolean;
  shortfall: number;
  exceptions: unknown[];
  weightDisputes: unknown[];
}

/** The courier's file → a preview → one POST. */
function UploadDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [batchId, setBatchId] = useState("");
  const [courier, setCourier] = useState("Shiprocket");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setBatchId("");
    setFileName(null);
    setRows(null);
    setProblem(null);
  };

  const record = useMutation({
    mutationFn: () =>
      opsFetch<IngestReport>("/admin/siumora/remittances", {
        method: "POST",
        body: JSON.stringify({ batchId: batchId.trim(), courier: courier.trim(), rows }),
      }),
    onSuccess: async (report) => {
      const toCheck = report.exceptions.length + report.weightDisputes.length;
      toast.success(
        report.replayed
          ? "This batch was already recorded — nothing changed."
          : `Recorded ${report.recorded} orders${toCheck > 0 ? `, ${toCheck} to check` : ""}${
              report.shortfall > 0 ? ` · ${inr(report.shortfall)} short` : ""
            }.`,
      );
      await client.invalidateQueries({ queryKey: ["siumora", "remittances"] });
      reset();
      onOpenChange(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Refused."),
  });

  const submit = () => {
    if (!batchId.trim()) return void toast.error("Give the batch its reference from the courier's statement.");
    if (!courier.trim()) return void toast.error("Name the courier.");
    if (!rows) return void toast.error(problem ?? "Choose the remittance file.");
    record.mutate();
  };

  const total = (key: "collected" | "deductions" | "remitted") => (rows ?? []).reduce((sum, row) => sum + row[key], 0);

  return (
    <EditDrawer
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Record a remittance file"
      description="The courier's COD remittance statement, matched order by order against what each order should have paid."
      saving={record.isPending}
      onSave={submit}
      saveLabel="Record batch"
    >
      <FormField
        label="Batch reference"
        hint="The remittance or UTR number on the courier's statement. Recording the same batch twice changes nothing."
      >
        <Input size="small" value={batchId} onChange={(event) => setBatchId(event.target.value)} />
      </FormField>
      <FormField label="Courier">
        <Input size="small" value={courier} onChange={(event) => setCourier(event.target.value)} />
      </FormField>
      <FormField
        label="Remittance file"
        hint="CSV with an order number, the COD collected and the amount remitted per row; charges and weights are read when present."
      >
        <div className="flex items-center gap-x-3">
          <Button size="small" variant="secondary" onClick={() => file.current?.click()}>
            Choose a file
          </Button>
          <Text size="small" className="text-ui-fg-subtle">
            {fileName ?? "No file chosen"}
          </Text>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              setFileName(chosen.name);
              const parsed = parseRemittanceCsv(await chosen.text());
              setRows(parsed.ok ? parsed.rows : null);
              setProblem(parsed.ok ? null : parsed.message);
            }}
          />
        </div>
      </FormField>
      {problem && (
        <Text size="small" className="text-ui-fg-error">
          {problem}
        </Text>
      )}
      {rows && (
        <div className="flex flex-col gap-y-1 rounded-lg border px-4 py-3">
          <Text size="small" weight="plus">
            {rows.length} orders in this file
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Collected {inr(total("collected"))} · charges {inr(total("deductions"))} · remitted {inr(total("remitted"))}
          </Text>
        </div>
      )}
    </EditDrawer>
  );
}

const RemittancesPage = () => {
  const [uploading, setUploading] = useState(false);
  const desk = useQuery({
    queryKey: ["siumora", "remittances"],
    queryFn: () => opsFetch<Desk>("/admin/siumora/remittances"),
  });
  if (desk.isLoading) return <CardSkeleton rows={4} />;
  if (!desk.data) return <CardError title="COD remittances" message={desk.error?.message ?? "Could not load."} />;
  const d = desk.data;

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <SectionHeader
          level="h1"
          title="COD remittances"
          subtitle={`With the courier now: ${inr(d.cash.codAwaitingRemittance)} · remitted so far: ${inr(d.cash.codRemitted)}`}
          actions={[[{ label: "Record a remittance file", icon: <ArrowUpTray />, onClick: () => setUploading(true) }]]}
        />
        {d.batches.length === 0 ? (
          <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
            No remittance batches recorded yet.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Batch</Table.HeaderCell>
                <Table.HeaderCell>Orders</Table.HeaderCell>
                <Table.HeaderCell>Collected</Table.HeaderCell>
                <Table.HeaderCell>Deductions</Table.HeaderCell>
                <Table.HeaderCell>Remitted</Table.HeaderCell>
                <Table.HeaderCell>Matched</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {d.batches.map((batch) => (
                <Table.Row key={batch.batchId}>
                  <Table.Cell>
                    {batch.batchId}
                    {batch.reconciledAt && <span className="text-ui-fg-subtle"> · {when(batch.reconciledAt)}</span>}
                  </Table.Cell>
                  <Table.Cell>{batch.rows}</Table.Cell>
                  <Table.Cell>{inr(batch.collected)}</Table.Cell>
                  <Table.Cell>{inr(batch.deductions)}</Table.Cell>
                  <Table.Cell>{inr(batch.remitted)}</Table.Cell>
                  <Table.Cell>
                    {batch.exceptions === 0 ? (
                      <StatusBadge color="green">All</StatusBadge>
                    ) : (
                      <StatusBadge color="orange">{batch.exceptions} to check</StatusBadge>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {d.exceptions.length > 0 && (
        <Container className="divide-y p-0">
          <SectionHeader title="Needs a person" subtitle="Lines the payout did not explain." />
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Batch</Table.HeaderCell>
                <Table.HeaderCell>Problem</Table.HeaderCell>
                <Table.HeaderCell>Difference</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {d.exceptions.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell>{row.orderNumber ?? "—"}</Table.Cell>
                  <Table.Cell>{row.batchId}</Table.Cell>
                  <Table.Cell>{row.outcome ? humanize(row.outcome) : "—"}</Table.Cell>
                  <Table.Cell>
                    {typeof row.variance === "number" ? inr(row.variance) : "—"}
                    {row.excessWeightGrams ? ` · ${row.excessWeightGrams} g over` : ""}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      <UploadDrawer open={uploading} onOpenChange={setUploading} />
    </div>
  );
};

// No route config: reached from the Siumora home's menu, not the sidebar.
export default RemittancesPage;
