import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import { Button, Container, Input, Text, Textarea, toast } from "@medusajs/ui";
import { useRef, useState } from "react";
// @ts-ignore -- workspace ESM types with CJS runtime
import { DEFAULT_STOREFRONT, type StorefrontContent } from "@siumora/core/storefront";

import { CardSkeleton, EditDrawer, FormField, KeyValueRow, SectionHeader } from "../components/kit";
import { OpsError, opsFetch } from "../lib/ops";
import { useSaveSettings, useSiumoraSettings } from "../lib/queries";

/**
 * Store › Storefront (plan 16 Phase E) — the homepage hero and the
 * announcement bar, on the Store page beside Checkout & COD. Shown as it
 * reads; edited in a drawer and published as one change (the storefront
 * picks it up on its next short revalidation).
 */

const StoreStorefrontWidget = () => {
  const settings = useSiumoraSettings();
  const save = useSaveSettings("Storefront content published.");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StorefrontContent>(DEFAULT_STOREFRONT);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (settings.isLoading) return <CardSkeleton rows={4} />;
  if (!settings.data) return null; // the Checkout card already says why
  const content = (settings.data.storefrontContent as StorefrontContent | undefined) ?? DEFAULT_STOREFRONT;

  const set = (key: keyof StorefrontContent) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: event.target.value });

  const upload = async (chosen: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(chosen.type) || chosen.size > 5 * 1024 * 1024) {
      toast.error("Choose a JPEG, PNG or WebP under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("files", chosen);
      const result = await opsFetch<{ files: { url: string }[] }>("/admin/uploads", { method: "POST", body: form });
      const url = result.files[0]?.url;
      if (!url) throw new Error("The upload returned no image.");
      setDraft((current) => ({ ...current, image: url }));
    } catch (error) {
      toast.error(error instanceof OpsError || error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Storefront"
        subtitle="The homepage hero and the announcement bar."
        actions={[
          [
            {
              label: "Edit storefront content",
              icon: <PencilSquare />,
              onClick: () => {
                setDraft(content);
                setEditing(true);
              },
            },
          ],
        ]}
      />
      <KeyValueRow label="Announcement">{content.announcement}</KeyValueRow>
      <KeyValueRow label="Hero">
        {content.title} {content.subtitle}
      </KeyValueRow>
      <KeyValueRow label="Main button">
        {content.buttonLabel} → {content.buttonHref}
      </KeyValueRow>
      <div className="px-6 py-4">
        <img src={content.image} alt={content.imageAlt} className="max-h-40 rounded-md object-contain" />
      </div>

      <EditDrawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit storefront content"
        description="Published together. The storefront shows it within a few seconds."
        saving={save.isPending || uploading}
        saveLabel="Publish"
        onSave={() =>
          save.mutate([{ key: "storefront_content", value: draft }], { onSuccess: () => setEditing(false) })
        }
      >
        <FormField label="Announcement bar">
          <Input value={draft.announcement} maxLength={200} onChange={set("announcement")} />
        </FormField>
        <FormField label="Small line above the title">
          <Input value={draft.eyebrow} maxLength={80} onChange={set("eyebrow")} />
        </FormField>
        <FormField label="Title">
          <Input value={draft.title} maxLength={120} onChange={set("title")} />
        </FormField>
        <FormField label="Title, second line" hint="Shown in the accent colour.">
          <Input value={draft.subtitle} maxLength={120} onChange={set("subtitle")} />
        </FormField>
        <FormField label="Description">
          <Textarea rows={3} value={draft.description} maxLength={400} onChange={set("description")} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Main button text">
            <Input value={draft.buttonLabel} maxLength={40} onChange={set("buttonLabel")} />
          </FormField>
          <FormField label="Main button link">
            <Input value={draft.buttonHref} maxLength={200} onChange={set("buttonHref")} />
          </FormField>
          <FormField label="Second link text">
            <Input value={draft.secondaryLabel} maxLength={40} onChange={set("secondaryLabel")} />
          </FormField>
          <FormField label="Second link">
            <Input value={draft.secondaryHref} maxLength={200} onChange={set("secondaryHref")} />
          </FormField>
        </div>
        <FormField label="Note under the buttons">
          <Input value={draft.note} maxLength={120} onChange={set("note")} />
        </FormField>
        <FormField label="Hero image" hint="JPEG, PNG or WebP, up to 5 MB.">
          <div className="flex items-center gap-x-3">
            <img src={draft.image} alt="" className="h-16 w-24 rounded-md object-cover" />
            <Button size="small" variant="secondary" isLoading={uploading} onClick={() => file.current?.click()}>
              Replace image
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void upload(chosen);
                event.target.value = "";
              }}
            />
          </div>
        </FormField>
        <FormField label="Image description" hint="Read aloud to people using a screen reader.">
          <Input value={draft.imageAlt} maxLength={200} onChange={set("imageAlt")} />
        </FormField>
        <Text size="xsmall" className="text-ui-fg-subtle">
          Product pages, categories and collections are edited in their own native sections.
        </Text>
      </EditDrawer>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "store.details.after",
});

export default StoreStorefrontWidget;
