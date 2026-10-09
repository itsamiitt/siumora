import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ListBullet } from "@medusajs/icons";
import { Button, Container, Heading, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";

interface Entry {
  id: string; name: string; email: string; createdAt: string;
  customerId: string | null; orderCount: number; latestOrderId: string | null;
}
interface WaitlistPage { entries: Entry[]; hasMore: boolean; page: number }

const WaitlistPage = () => {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<WaitlistPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    opsFetch<WaitlistPage>(`/admin/siumora/waitlist?page=${page}`)
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause instanceof OpsError ? cause.message : "Could not load the waiting list."); });
    return () => { active = false; };
  }, [page]);

  return <Container className="p-6">
    <Heading level="h1">Waiting list</Heading>
    <Text size="small" className="mt-1 text-ui-fg-subtle">People who asked to hear when Siumora opens. Customer and order matches use the same email address. Only owners can view these details.</Text>
    {error && <Text size="small" className="mt-4 text-ui-fg-error">{error}</Text>}
    {data && <>
      <Table className="mt-4">
        <Table.Header><Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell>Email</Table.HeaderCell>
          <Table.HeaderCell>Joined</Table.HeaderCell>
          <Table.HeaderCell>Customer</Table.HeaderCell>
          <Table.HeaderCell>Orders using email</Table.HeaderCell>
        </Table.Row></Table.Header>
        <Table.Body>{data.entries.map((entry) => <Table.Row key={entry.id}>
          <Table.Cell>{entry.name}</Table.Cell>
          <Table.Cell>{entry.email}</Table.Cell>
          <Table.Cell>{new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Table.Cell>
          <Table.Cell>{entry.customerId
            ? <a className="text-ui-fg-interactive hover:underline" href={`/app/customers/${encodeURIComponent(entry.customerId)}`}>View customer</a>
            : "—"}</Table.Cell>
          <Table.Cell>{entry.latestOrderId
            ? <a className="text-ui-fg-interactive hover:underline" href={`/app/orders/${encodeURIComponent(entry.latestOrderId)}`}>{entry.orderCount} · Latest order</a>
            : "0"}</Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table>
      {data.entries.length === 0 && <Text size="small" className="mt-4 text-ui-fg-subtle">No signups on this page.</Text>}
      <div className="mt-4 flex items-center gap-3">
        <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Text size="small">Page {page + 1}</Text>
        <Button size="small" variant="secondary" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </>}
  </Container>;
};

export const config = defineRouteConfig({ label: "Waiting list", icon: ListBullet });
export default WaitlistPage;
