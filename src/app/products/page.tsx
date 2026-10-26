"use client";

import { randomUUID } from "@/lib/uuid";
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { LuPlus, LuTrash2, LuPencil, LuPackage, LuImage, LuX, LuVideo, LuCircleAlert, LuLink, LuLoader } from "react-icons/lu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProductLibraryStore,
  type ProductItem,
} from "@/lib/stores/product-library-store";
import { getExampleProducts } from "@/lib/examples";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useT, useLocale } from "@/lib/i18n";

// Category options (label uses an i18n key; resolved at runtime via t())
const categoryOptions = [
  { value: "beauty", labelKey: "categoryBeauty" },
  { value: "food", labelKey: "categoryFood" },
  { value: "home", labelKey: "categoryHome" },
  { value: "fashion", labelKey: "categoryFashion" },
  { value: "tech", labelKey: "categoryTech" },
  { value: "other", labelKey: "categoryOther" },
] as const;

// Category color mapping
const categoryColorMap: Record<string, string> = {
  beauty: "bg-pink-500/20 text-pink-400",
  food: "bg-amber-500/20 text-amber-400",
  home: "bg-blue-500/20 text-blue-400",
  fashion: "bg-purple-500/20 text-purple-400",
  tech: "bg-cyan-500/20 text-cyan-400",
  other: "bg-zinc-500/20 text-zinc-400",
};

// Category value → i18n key mapping
const categoryLabelKeyMap: Record<string, string> = Object.fromEntries(
  categoryOptions.map((opt) => [opt.value, opt.labelKey])
);

export default function ProductsPage() {
  const t = useT("products");
  // "make video" destination depends on the workspace mode (single beginner path vs. full form)
  const uiMode = useSettingsStore((s) => s.uiMode);
  const locale = useLocale();
  const { products, addProduct, updateProduct, removeProduct } =
    useProductLibraryStore();

  // One-click import of example products (lets new users quickly try batch rendering / viral-clip replication)
  const importExamples = useCallback(() => {
    const existingNames = new Set(products.map((p) => p.name));
    getExampleProducts(locale).forEach((ex) => {
      if (existingNames.has(ex.name)) return;
      addProduct({
        id: randomUUID(),
        name: ex.name,
        category: ex.category,
        description: ex.sellingPoints,
        images: [ex.image],
        price: ex.price,
        targetAudience: "",
        videoCount: 0,
        createdAt: new Date(),
      });
    });
  }, [products, addProduct, locale]);

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductItem["category"]>("other");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [targetAudience, setTargetAudience] = useState("");

  // Image upload state
  const [images, setImages] = useState<{ id: string; url: string; file?: File }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save state (uploading product images requires server-side persistence, so save is async)
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ---- link import: paste a product URL → real page fetch + AI extraction (existing ingest
  // chain) → the parsed fields land in the SAME editable form as a review gate — nothing
  // enters the library until the user confirms with Save. ----
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedNotice, setImportedNotice] = useState(false);
  // images are downloaded server-side under this pre-generated library id, so Save must reuse it
  const importIdRef = useRef<string | null>(null);

  const handleImportExtract = async () => {
    const url = importUrl.trim();
    if (!url || importLoading) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const libraryProductId = randomUUID();
      const res = await fetch("/api/ingest/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, createProject: false, libraryProductId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t("importFailed"));
      const parsed = (data?.product ?? {}) as { title?: string; priceText?: string; description?: string };
      const savedImages = Array.isArray(data?.images) ? (data.images as string[]) : [];
      // prefill the form as the review gate (all fields editable, category picked by hand)
      importIdRef.current = libraryProductId;
      setEditingId(null);
      setName(parsed.title ?? "");
      setCategory("other");
      setDescription(parsed.description ?? "");
      setPrice(parsed.priceText ?? "");
      setTargetAudience("");
      setImages(savedImages.map((u) => ({ id: randomUUID(), url: u })));
      setSaveError(null);
      setIsFormOpen(true);
      setImportOpen(false);
      setImportUrl("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("importFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setName("");
    setCategory("other");
    setDescription("");
    setPrice("");
    setTargetAudience("");
    // Revoke preview-only blob URLs to avoid memory leaks
    setImages((prev) => {
      prev.forEach((img) => {
        if (img.file) URL.revokeObjectURL(img.url);
      });
      return [];
    });
    setSaveError(null);
    setIsFormOpen(false);
    setEditingId(null);
    importIdRef.current = null;
  };

  // Handle image file selection
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - images.length;
      if (remaining <= 0) return;

      const newImages = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({
          id: randomUUID(),
          url: URL.createObjectURL(file),
          file,
        }));

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length]
  );

  // Drag-and-drop event handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // Remove image
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // Open the edit form
  const startEdit = (product: ProductItem) => {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setDescription(product.description || "");
    setPrice(product.price || "");
    setTargetAudience(product.targetAudience || "");
    // Convert existing image URLs to display format
    setImages(
      product.images.map((url) => ({
        id: randomUUID(),
        url,
      }))
    );
    setIsFormOpen(true);
  };

  // Save product: newly added images (with a file object) are uploaded to the server first to get
  // a persistent /api/files URL — avoids storing blob: URLs directly, which break after a refresh
  // or when navigating to the "make video" page (broken images / can't pass URL to new-project page)
  const handleSave = async () => {
    if (!name.trim() || isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      // Reuse existing id when editing; a link import already stored its images under a
      // pre-generated id, so Save must keep it; otherwise generate a new one
      const productId = editingId ?? importIdRef.current ?? randomUUID();
      const wasImport = !editingId && importIdRef.current !== null;

      // Only items with a file object are newly selected — those need uploading; existing server/example URLs stay as-is
      const filesToUpload = images.filter((img) => img.file);
      let uploadedPaths: string[] = [];
      if (filesToUpload.length > 0) {
        const formData = new FormData();
        filesToUpload.forEach((img) => formData.append("files", img.file!));
        formData.append("productId", productId);
        const res = await fetch("/api/products/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || t("uploadFailed"));
        }
        const data = await res.json();
        uploadedPaths = data.paths as string[];
      }

      // Assemble final URLs in original order: new images use the uploaded server path, old images keep their existing URL
      let cursor = 0;
      const imageUrls = images.map((img) =>
        img.file ? uploadedPaths[cursor++] : img.url
      );

      if (editingId) {
        // Edit mode
        updateProduct(editingId, {
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          images: imageUrls,
          price: price.trim() || undefined,
          targetAudience: targetAudience.trim() || undefined,
        });
      } else {
        // Add mode
        const newProduct: ProductItem = {
          id: productId,
          name: name.trim(),
          category,
          description: description.trim() || undefined,
          images: imageUrls,
          price: price.trim() || undefined,
          targetAudience: targetAudience.trim() || undefined,
          videoCount: 0,
          createdAt: new Date(),
        };
        addProduct(newProduct);
      }

      if (wasImport) setImportedNotice(true);
      resetForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  // Delete product
  const handleDelete = (id: string) => {
    removeProduct(id);
    // If the deleted product is currently being edited, close the form
    if (editingId === id) resetForm();
  };

  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Page title + add button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="brand-gradient-text">{t("pageTitleAccent")}</span>{t("pageTitleRest")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("pageSubtitle")}
            </p>
          </div>
          {!isFormOpen && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setImportOpen((v) => !v);
                  setImportError(null);
                }}
              >
                <LuLink className="w-4 h-4 mr-1.5" />
                {t("importLink")}
              </Button>
              <Button
                className="brand-gradient text-white"
                onClick={() => {
                  resetForm();
                  setIsFormOpen(true);
                }}
              >
                <LuPlus className="w-4 h-4 mr-1.5" />
                {t("addProduct")}
              </Button>
            </div>
          )}
        </div>

        {/* post-confirm shortcut: the freshly stocked library feeds straight into batch rendering */}
        {importedNotice && !isFormOpen && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <p className="text-sm text-emerald-400">✓ {t("importSaved")}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/batch">
                <Button size="sm" variant="outline" className="text-xs">{t("importGoBatch")}</Button>
              </Link>
              <button
                type="button"
                onClick={() => setImportedNotice(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50"
                aria-label={t("cancel")}
              >
                <LuX className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* link-import entry: paste URL → extract → review in the form before it enters the library */}
        {importOpen && !isFormOpen && (
          <Card className="glass-card ring-1 ring-primary/30 mb-8">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-semibold">{t("importLinkTitle")}</h3>
              <div className="flex gap-2">
                <Input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder={t("importLinkPlaceholder")}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                  onKeyDown={(e) => { if (e.key === "Enter") void handleImportExtract(); }}
                />
                <Button
                  className="brand-gradient text-white shrink-0"
                  disabled={!importUrl.trim() || importLoading}
                  onClick={handleImportExtract}
                >
                  {importLoading ? (
                    <>
                      <LuLoader className="w-4 h-4 mr-1.5 animate-spin" />
                      {t("importExtracting")}
                    </>
                  ) : (
                    t("importExtract")
                  )}
                </Button>
              </div>
              {importError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <LuCircleAlert className="w-4 h-4 shrink-0" />
                  {importError}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => {
                      setImportOpen(false);
                      resetForm();
                      setIsFormOpen(true);
                    }}
                  >
                    {t("importFallbackManual")}
                  </button>
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t("importHint")}</p>
            </CardContent>
          </Card>
        )}

        {/* Add / edit form */}
        {isFormOpen && (
          <Card className="glass-card ring-1 ring-primary/30 mb-8">
            <CardContent className="p-5 space-y-5">
              <h3 className="text-sm font-semibold">
                {editingId ? t("formEditTitle") : t("formAddTitle")}
              </h3>
              {/* review gate for link imports: extracted fields are proposals — check, fix, then confirm */}
              {!editingId && importIdRef.current && (
                <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  {t("importReviewHint")}
                </p>
              )}

              {/* Product name */}
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm font-medium">
                  {t("fieldName")}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="productName"
                  placeholder={t("namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                />
              </div>

              {/* Category selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("fieldCategory")}</Label>
                <Select
                  value={category}
                  onValueChange={(val) =>
                    setCategory((val ?? "other") as ProductItem["category"])
                  }
                >
                  <SelectTrigger className="w-full bg-muted/30 border-border/50">
                    {/* Base UI's Select.Value shows the raw value by default — use a function child to map it to a localized label */}
                    <SelectValue>
                      {(value: string) =>
                        categoryLabelKeyMap[value]
                          ? t(categoryLabelKeyMap[value])
                          : t("categoryPlaceholder")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Selling-point description */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description" className="text-sm font-medium">
                    {t("fieldDescription")}
                  </Label>
                  <span className="text-xs text-muted-foreground">{t("optional")}</span>
                </div>
                <Textarea
                  id="description"
                  placeholder={t("descriptionPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>

              {/* Product image upload */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-medium">{t("fieldImages")}</Label>
                  <span className="text-xs text-muted-foreground">
                    {t("imageCount", { n: images.length })}
                  </span>
                </div>

                {/* Drag-and-drop upload area */}
                {images.length < 5 && (
                  <div
                    className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-primary/50 hover:bg-muted/20"
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
                        <LuImage className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {t("dropHintPrefix")}
                          <span className="brand-gradient-text font-semibold">
                            {t("dropHintClick")}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("dropHintFormats")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Uploaded image preview grid */}
                {images.length > 0 && (
                  <div
                    className={`grid grid-cols-3 sm:grid-cols-5 gap-3 ${
                      images.length < 5 ? "mt-4" : ""
                    }`}
                  >
                    {images.map((img) => (
                      <div
                        key={img.id}
                        className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/20"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={t("imageAlt")}
                          className="h-full w-full object-cover"
                        />
                        {/* Delete button */}
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        >
                          <LuX className="w-3 h-3" />
                        </button>
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Price info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="price" className="text-sm font-medium">
                      {t("fieldPrice")}
                    </Label>
                    <span className="text-xs text-muted-foreground">{t("optional")}</span>
                  </div>
                  <Input
                    id="price"
                    placeholder={t("pricePlaceholder")}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="bg-muted/30 border-border/50 focus:border-primary"
                  />
                </div>

                {/* Target audience */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="targetAudience"
                      className="text-sm font-medium"
                    >
                      {t("fieldAudience")}
                    </Label>
                    <span className="text-xs text-muted-foreground">{t("optional")}</span>
                  </div>
                  <Input
                    id="targetAudience"
                    placeholder={t("audiencePlaceholder")}
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="bg-muted/30 border-border/50 focus:border-primary"
                  />
                </div>
              </div>

              {/* Upload / save error message */}
              {saveError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <LuCircleAlert className="w-4 h-4 shrink-0" />
                  {saveError}
                </p>
              )}

              {/* Save / cancel buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={resetForm} disabled={isSaving}>
                  {t("cancel")}
                </Button>
                <Button
                  size="sm"
                  className="brand-gradient text-white"
                  onClick={handleSave}
                  disabled={!name.trim() || isSaving}
                >
                  {isSaving ? t("saving") : editingId ? t("saveEdit") : t("addProduct")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Product list */}
        {products.length === 0 && !isFormOpen ? (
          // Empty state
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                <LuPackage className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-4">
                {t("emptyText")}
              </p>
              <div className="flex items-center gap-3">
                <Button
                  className="brand-gradient text-white"
                  onClick={() => {
                    resetForm();
                    setIsFormOpen(true);
                  }}
                >
                  <LuPlus className="w-4 h-4 mr-1.5" />
                  {t("addProduct")}
                </Button>
                <Button variant="outline" onClick={importExamples}>
                  {t("importExamples")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">{t("emptyHint")}</p>
            </CardContent>
          </Card>
        ) : (
          products.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">{t("allProducts")}</h2>
                <span className="text-sm text-muted-foreground">
                  {t("productCount", { n: products.length })}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {products.map((product) => (
                  <Card
                    key={product.id}
                    className="card-hover glass-card group"
                  >
                    <CardContent className="p-0">
                      {/* Product thumbnail */}
                      <div className="relative aspect-video bg-muted/30 rounded-t-lg overflow-hidden">
                        {product.images.length > 0 ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <LuImage className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                        )}
                        {/* Category badge */}
                        <div className="absolute top-2 left-2">
                          <Badge
                            className={`${
                              categoryColorMap[product.category] || categoryColorMap.other
                            } border-0 text-xs`}
                          >
                            {t(categoryLabelKeyMap[product.category] || "categoryOther")}
                          </Badge>
                        </div>
                        {/* Floating action buttons */}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(product);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-primary transition-colors"
                          >
                            <LuPencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(product.id);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500 transition-colors"
                          >
                            <LuTrash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {/* Product info */}
                      <div className="p-4">
                        <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {product.name}
                        </h3>
                        <div className="flex items-center justify-between mt-2">
                          {product.price && (
                            <span className="text-xs text-primary font-medium">
                              {product.price}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {t("videoCount", { n: product.videoCount })}
                          </span>
                        </div>
                        {/* Make video: beginner mode routes to the one-tap studio, director mode to the full advanced form — both pre-fill via productId */}
                        <Link href={`${uiMode === "pro" ? "/project/new" : "/start"}?productId=${product.id}`} className="block mt-3">
                          <Button size="sm" className="w-full brand-gradient text-white border-0">
                            <LuVideo className="w-3.5 h-3.5 mr-1.5" />
                            {t("makeVideo")}
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
}
