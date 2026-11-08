import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import { Container, Text, Textarea, toast } from "@medusajs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CardSkeleton, EditDrawer, FormField, SectionHeader } from "../components/kit";
import { opsFetch } from "../lib/ops";

/**
 * The storefront collection page's intro line. The storefront reads it from
 * metadata.description (packages/sdk mapCollection) because Medusa
 * collections have no description column — and the dashboard has no field
 * for metadata keys, so before this card it could only be set by API.
 */

interface CollectionRow {
  id: string;
  metadata?: Record<string, unknown> | null;
}

const MAX_LENGTH = 500;

const CollectionDescriptionWidget = ({ data }: { data: { id: string } }) => {
  const client = useQueryClient();
  const collection = useQuery({
    queryKey: ["siumora", "collection-description", data.id],
    queryFn: () =>
      opsFetch<{ collection: CollectionRow }>(`/admin/collections/${data.id}?fields=id,metadata`).then((r) => r.collection),
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");

  if (collection.isLoading) return <CardSkeleton rows={1} />;
  if (!collection.data) return null;
  const current = typeof collection.data.metadata?.description === "string" ? collection.data.metadata.description : "";

  const save = async () => {
    const description = draft.trim();
    if (description.length > MAX_LENGTH) {
      toast.error(`Keep it under ${MAX_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    try {
      // The whole metadata object is sent back, so other keys survive either way.
      await opsFetch(`/admin/collections/${data.id}`, {
        method: "POST",
        body: JSON.stringify({ metadata: { ...(collection.data?.metadata ?? {}), description } }),
      });
      await client.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(data.id) });
      toast.success("Description saved. The storefront shows it within a few seconds.");
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Storefront description"
        actions={[[{ label: "Edit", icon: <PencilSquare />, onClick: () => { setDraft(current); setEditing(true); } }]]}
      />
      <div className="px-6 py-4">
        <Text size="small" className={current ? "" : "text-ui-fg-subtle"}>
          {current || "None yet — the collection page shows only its title."}
        </Text>
      </div>
      <EditDrawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit storefront description"
        description="Shown under the title on this collection's page."
        saving={saving}
        onSave={() => void save()}
      >
        <FormField label="Description" hint={`${draft.trim().length}/${MAX_LENGTH} characters`}>
          <Textarea rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </FormField>
      </EditDrawer>
    </Container>
  );
};

export const config = defineWidgetConfig({ zone: "product_collection.details.after" });

export default CollectionDescriptionWidget;
