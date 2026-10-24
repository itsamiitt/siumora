import { Button, Container, Heading, Input, Text, toast } from "@medusajs/ui";
import { useState } from "react";
// @ts-ignore -- workspace ESM types with CJS runtime
import { DEFAULT_STOREFRONT, type StorefrontContent } from "@siumora/core/storefront";
import { opsFetch } from "./ops";
import { useSiumoraSettings } from "./settings-controls";

const labels: Record<keyof StorefrontContent, string> = {
  eyebrow: "Hero eyebrow", title: "Hero title", subtitle: "Hero second line",
  description: "Description", image: "Hero image URL", imageAlt: "Image description (accessibility)",
  buttonLabel: "Main button text", buttonHref: "Main button link", secondaryLabel: "Second link text",
  secondaryHref: "Second link destination", note: "Hero note", announcement: "Announcement bar",
};

export function StorefrontSettings() {
  const { settings, refusal, busy, write } = useSiumoraSettings();
  const [draft, setDraft] = useState<StorefrontContent | null>(null);
  const [uploading, setUploading] = useState(false);
  const content = draft ?? settings?.storefrontContent as StorefrontContent ?? DEFAULT_STOREFRONT;
  const change = (key: keyof StorefrontContent, value: string) => setDraft({ ...content, [key]: value });
  return <Container className="p-6">
    <Heading level="h2">Storefront and hero</Heading>
    <Text className="mt-2 text-ui-fg-subtle">Publish homepage content and the announcement bar together. The storefront refreshes content on its next short revalidation.</Text>
    {refusal ? <Text>{refusal}</Text> : !settings ? <Text>Loading content…</Text> : <>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(Object.keys(labels) as (keyof StorefrontContent)[]).map(key => <label key={key}><Text size="small" weight="plus">{labels[key]}</Text><Input value={content[key]} maxLength={1000} disabled={busy || uploading} onChange={event => change(key, event.target.value)} /></label>)}
      </div>
      <label className="mt-4 block"><Text size="small">Upload a hero image (JPEG, PNG, or WebP, up to 5 MB)</Text><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { toast.error("Choose a JPEG, PNG, or WebP under 5 MB."); return; }
        setUploading(true);
        try {
          const form = new FormData(); form.append("files", file);
          const result = await opsFetch<{ files: { url: string }[] }>("/admin/uploads", { method: "POST", body: form });
          if (!result.files[0]) throw new Error("Upload returned no image.");
          change("image", result.files[0].url);
          toast.success("Uploaded. Publish content to use this image.");
        } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed."); }
        finally { setUploading(false); event.target.value = ""; }
      }} /></label>
      <div className="mt-4 rounded-lg border p-4"><Text size="small" weight="plus">Preview</Text><img src={content.image} alt={content.imageAlt} className="mt-2 max-h-64 rounded object-contain" /><Heading level="h2" className="mt-3">{content.title} {content.subtitle}</Heading><Text>{content.description}</Text><Text className="mt-2">{content.buttonLabel} → {content.buttonHref}</Text></div>
      <div className="mt-4 flex gap-2"><Button disabled={busy || uploading || !draft} onClick={async () => { if (await write("storefront_content", content)) setDraft(null); }}>Publish content</Button><Button variant="secondary" disabled={busy || uploading || !draft} onClick={() => setDraft(null)}>Discard edits</Button></div>
    </>}
  </Container>;
}
