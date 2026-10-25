import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Button, Container, Table, Text } from "@medusajs/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CardError, CardSkeleton, SectionHeader } from "../../../components/kit";
import { opsFetch } from "../../../lib/ops";

/**
 * Customers › Waiting list — the people who asked to hear when Siumora
 * opens, under Customers in the sidebar (plan 16 Phase E) rather than as its
 * own top-level entry. Owner only; customer and order matches use the same
 * email address.
 */

interface Entry {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  customerId: string | null;
  orderCount: number;
  latestOrderId: string | null;
}
interface WaitlistPayload {
  entries: Entry[];
  hasMore: boolean;
  page: number;
}

const WaitlistPage = () => {
  const [page, setPage] = useState(0);
  const list = useQuery({
    queryKey: ["siumora", "waitlist", page],
    queryFn: () => opsFetch<WaitlistPayload>(`/admin/siumora/waitlist?page=${page}`),
    placeholderData: keepPreviousData,
  });

  if (list.isLoading) return <CardSkeleton rows={5} />;
  if (!list.data) return <CardError title="Waiting list" message={list.error?.message ?? "Could not load the waiting list."} />;
  const data = list.data;

  return (
    <Container className="divide-y p-0">
      <SectionHeader level="h1" title="Waiting list" subtitle="People who asked to hear when Siumora opens." />
      {data.entries.length === 0 ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          No signups on this page.
        </Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Joined</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Orders</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.entries.map((entry) => (
              <Table.Row key={entry.id}>
                <Table.Cell>{entry.name}</Table.Cell>
                <Table.Cell>{entry.email}</Table.Cell>
                <Table.Cell>
                  {new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </Table.Cell>
                <Table.Cell>
                  {entry.customerId ? (
                    <Link to={`/customers/${entry.customerId}`} className="text-ui-fg-interactive hover:underline">
                      View customer
                    </Link>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>
                  {entry.latestOrderId ? (
                    <Link to={`/orders/${entry.latestOrderId}`} className="text-ui-fg-interactive hover:underline">
                      {entry.orderCount} · latest
                    </Link>
                  ) : (
                    "0"
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      <div className="flex items-center justify-end gap-x-2 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Page {page + 1}
        </Text>
        <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Button size="small" variant="secondary" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({ label: "Waiting list", nested: "/customers" });
export default WaitlistPage;
