import { ArrowDownTray } from "@medusajs/icons";
import { Button, Container, Select, Table, Text, toast } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { SectionHeader, inr } from "../../../components/kit";
import { OpsError, opsFetch } from "../../../lib/ops";

/**
 * Siumora › GST returns (plan/07; made native in plan 16 Phase E): the
 * GSTR-1 return for a month, computed by the same engine that issued the
 * invoices (GET /admin/siumora/gstr1). Owner only — the route refuses
 * anyone else and this page shows the refusal wording the API chose.
 * Reached from the Siumora home's menu, not the sidebar.
 *
 * The CSV goes through an authenticated fetch → blob rather than a link:
 * the route needs the session cookie AND writes an audit entry per export.
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

/** The last twelve months, newest first, as "YYYY-MM" with a readable label. */
function recentMonths(): Array<{ value: string; label: string }> {
  const now = new Date();
  return Array.from({ length: 12 }, (_, back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return {
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
    };
  });
}

const GstPage = () => {
  const months = recentMonths();
  const [period, setPeriod] = useState(months[0]!.value);
  const [downloading, setDownloading] = useState(false);
  const gstr1 = useQuery({
    queryKey: ["siumora", "gstr1", period],
    queryFn: () => opsFetch<Gstr1>(`/admin/siumora/gstr1?period=${encodeURIComponent(period)}`),
    retry: false,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/admin/siumora/gstr1?period=${encodeURIComponent(period)}&format=csv`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("The CSV was refused — try again, or check your access.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gstr1-${period}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const data = gstr1.data;
  return (
    <Container className="divide-y p-0">
      <SectionHeader
        level="h1"
        title="GST returns"
        subtitle="GSTR-1 from the same engine that issued the invoices. Filing stays the accountant's job."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Select value={period} onValueChange={setPeriod}>
          <Select.Trigger className="w-56">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {months.map((month) => (
              <Select.Item key={month.value} value={month.value}>
                {month.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Button size="small" variant="secondary" disabled={!data} isLoading={downloading} onClick={() => void download()}>
          <ArrowDownTray />
          Download CSV
        </Button>
      </div>

      {gstr1.isLoading ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          Building the return…
        </Text>
      ) : !data ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          {gstr1.error instanceof OpsError ? gstr1.error.message : "Could not build the return."}
        </Text>
      ) : (
        <>
          <div className="px-6 py-4">
            <Text size="small">
              {data.totals.invoices} invoices · taxable {inr(data.totals.taxableValue)} · CGST {inr(data.totals.cgst)} · SGST{" "}
              {inr(data.totals.sgst)} · IGST {inr(data.totals.igst)}
            </Text>
          </div>
          <Table>
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
              {data.hsn.length === 0 ? (
                <Table.Row>
                  <Table.Cell>No invoices this month.</Table.Cell>
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                </Table.Row>
              ) : (
                data.hsn.map((row) => (
                  <Table.Row key={`${row.hsn}-${row.slab}`}>
                    <Table.Cell>{row.hsn}</Table.Cell>
                    <Table.Cell>{row.slab}%</Table.Cell>
                    <Table.Cell>{inr(row.taxableValue)}</Table.Cell>
                    <Table.Cell>{inr(row.cgst)}</Table.Cell>
                    <Table.Cell>{inr(row.sgst)}</Table.Cell>
                    <Table.Cell>{inr(row.igst)}</Table.Cell>
                    <Table.Cell>{inr(row.total)}</Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </>
      )}
    </Container>
  );
};

// No route config: reached from the Siumora home's menu, not the sidebar.
export default GstPage;
