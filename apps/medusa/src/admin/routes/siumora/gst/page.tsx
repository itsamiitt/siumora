import { defineRouteConfig } from "@medusajs/admin-sdk";
import { DocumentText } from "@medusajs/icons";
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui";
import { useState } from "react";

import { OpsError, inr, opsFetch } from "../../../lib/ops";

/**
 * Siumora · GST desk (plan/07): the GSTR-1 return for a period, computed by
 * the same engine that produced the invoices (GET /admin/siumora/gstr1).
 * Owner only — the route refuses anyone else and this page shows the
 * refusal wording the API chose.
 *
 * Downloads go through a plain fetch → blob rather than an <a href>: the
 * route needs the session cookie AND writes an audit entry per export, so
 * every download must be a real authenticated request.
 */

interface Gstr1 {
  period: string;
  totals: { invoices: number; taxableValue: number; cgst: number; sgst: number; igst: number };
  hsn: Array<{
    hsn: string;
    slab: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
  }>;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const GstPage = () => {
  const [period, setPeriod] = useState(currentPeriod());
  const [gstr1, setGstr1] = useState<Gstr1 | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      setGstr1(
        await opsFetch<Gstr1>(`/admin/siumora/gstr1?period=${encodeURIComponent(period)}`),
      );
    } catch (error) {
      setGstr1(null);
      setRefusal(
        error instanceof OpsError ? error.message : "Could not build the return.",
      );
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const response = await fetch(
      `/admin/siumora/gstr1?period=${encodeURIComponent(period)}&format=csv`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gstr1-${period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h1">GST desk</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          The GSTR-1 return, from the same engine that issued the invoices.
          Filing stays the accountant's job.
        </Text>
        <div className="mt-4 flex items-end gap-2">
          <div>
            <Text size="small" weight="plus">Period (YYYY-MM)</Text>
            <Input value={period} onChange={(event) => setPeriod(event.target.value)} />
          </div>
          <Button size="small" onClick={load} isLoading={busy}>
            Build return
          </Button>
          {gstr1 && (
            <Button size="small" variant="secondary" onClick={download}>
              Download CSV
            </Button>
          )}
        </div>
        {refusal && (
          <Text size="small" className="mt-3 text-ui-fg-error">{refusal}</Text>
        )}
      </Container>

      {gstr1 && (
        <Container className="p-6">
          <div className="flex items-center justify-between">
            <Heading level="h2">{gstr1.period}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {gstr1.totals.invoices} invoices · taxable {inr(gstr1.totals.taxableValue)}
            </Text>
          </div>
          <Table className="mt-3">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>HSN</Table.HeaderCell>
                <Table.HeaderCell>Rate</Table.HeaderCell>
                <Table.HeaderCell>Taxable</Table.HeaderCell>
                <Table.HeaderCell>CGST</Table.HeaderCell>
                <Table.HeaderCell>SGST</Table.HeaderCell>
                <Table.HeaderCell>IGST</Table.HeaderCell>
                <Table.HeaderCell>Total</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {gstr1.hsn.map((row) => (
                <Table.Row key={`${row.hsn}-${row.slab}`}>
                  <Table.Cell>{row.hsn}</Table.Cell>
                  <Table.Cell>{row.slab}%</Table.Cell>
                  <Table.Cell>{inr(row.taxableValue)}</Table.Cell>
                  <Table.Cell>{inr(row.cgst)}</Table.Cell>
                  <Table.Cell>{inr(row.sgst)}</Table.Cell>
                  <Table.Cell>{inr(row.igst)}</Table.Cell>
                  <Table.Cell>{inr(row.total)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "GST desk",
  icon: DocumentText,
});

export default GstPage;
