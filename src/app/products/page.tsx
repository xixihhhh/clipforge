"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { LuPlus, LuTrash2, LuPencil, LuPackage, LuArrowLeft, LuImage, LuX } from "react-icons/lu";
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
import { exampleProducts } from "@/lib/examples";

// 品类选项
const categoryOptions = [
  { value: "beauty", label: "美妆护肤" },
  { value: "food", label: "食品零食" },
  { value: "home", label: "家居日用" },
  { value: "fashion", label: "服饰鞋包" },
  { value: "tech", label: "数码3C" },
  { value: "other", label: "其他" },
] as const;

// 品类颜色映射
const categoryColorMap: Record<string, string> = {
  beauty: "bg-pink-500/20 text-pink-400",
  food: "bg-amber-500/20 text-amber-400",
  home: "bg-blue-500/20 text-blue-400",
  fashion: "bg-purple-500/20 text-purple-400",
  tech: "bg-cyan-500/20 text-cyan-400",
  other: "bg-zinc-500/20 text-zinc-400",
};

// 品类中文名映射
const categoryLabelMap: Record<string, string> = Object.fromEntries(
  categoryOptions.map((opt) => [opt.value, opt.label])
);

export default function ProductsPage() {
  const { products, addProduct, updateProduct, removeProduct } =
    useProductLibraryStore();

  // 一键导入示例商品（方便新手快速体验批量出片/爆款复刻）
  const importExamples = useCallback(() => {
    const existingNames = new Set(products.map((p) => p.name));
    exampleProducts.forEach((ex) => {
      if (existingNames.has(ex.name)) return;
      addProduct({
        id: crypto.randomUUID(),
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
  }, [products, addProduct]);

  // 表单状态
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductItem["category"]>("other");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [targetAudience, setTargetAudience] = useState("");

  // 图片上传状态
  const [images, setImages] = useState<{ id: string; url: string; file?: File }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 重置表单
  const resetForm = () => {
    setName("");
    setCategory("other");
    setDescription("");
    setPrice("");
    setTargetAudience("");
    setImages([]);
    setIsFormOpen(false);
    setEditingId(null);
  };

  // 处理图片选择
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const remaining = 5 - images.length;
      if (remaining <= 0) return;

      const newImages = Array.from(files)
        .slice(0, remaining)
        .filter((f) => f.type.startsWith("image/"))
        .map((file) => ({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(file),
          file,
        }));

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length]
  );

  // 拖拽事件处理
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

  // 删除图片
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // 打开编辑表单
  const startEdit = (product: ProductItem) => {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setDescription(product.description || "");
    setPrice(product.price || "");
    setTargetAudience(product.targetAudience || "");
    // 将已有图片 URL 转为展示格式
    setImages(
      product.images.map((url) => ({
        id: crypto.randomUUID(),
        url,
      }))
    );
    setIsFormOpen(true);
  };

  // 保存商品
  const handleSave = () => {
    if (!name.trim()) return;

    const imageUrls = images.map((img) => img.url);

    if (editingId) {
      // 编辑模式
      updateProduct(editingId, {
        name: name.trim(),
        category,
        description: description.trim() || undefined,
        images: imageUrls,
        price: price.trim() || undefined,
        targetAudience: targetAudience.trim() || undefined,
      });
    } else {
      // 新增模式
      const newProduct: ProductItem = {
        id: crypto.randomUUID(),
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

    resetForm();
  };

  // 删除商品
  const handleDelete = (id: string) => {
    removeProduct(id);
    // 如果正在编辑被删除的商品，关闭表单
    if (editingId === id) resetForm();
  };

  return (
    <div className="min-h-screen grid-bg">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">商品库</span>
          </div>
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <LuArrowLeft className="w-4 h-4" />
              <span className="ml-1.5">返回首页</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* 页面标题 + 添加按钮 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="brand-gradient-text">商品库</span>管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              集中管理你的商品信息，创建项目时可快速选用
            </p>
          </div>
          {!isFormOpen && (
            <Button
              className="brand-gradient text-white"
              onClick={() => {
                resetForm();
                setIsFormOpen(true);
              }}
            >
              <LuPlus className="w-4 h-4 mr-1.5" />
              添加商品
            </Button>
          )}
        </div>

        {/* 添加/编辑表单 */}
        {isFormOpen && (
          <Card className="glass-card ring-1 ring-primary/30 mb-8">
            <CardContent className="p-5 space-y-5">
              <h3 className="text-sm font-semibold">
                {editingId ? "编辑商品" : "添加商品"}
              </h3>

              {/* 商品名称 */}
              <div className="space-y-2">
                <Label htmlFor="productName" className="text-sm font-medium">
                  商品名称
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="productName"
                  placeholder="例如：小米手环8 NFC版"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-muted/30 border-border/50 focus:border-primary"
                />
              </div>

              {/* 品类选择 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">商品品类</Label>
                <Select
                  value={category}
                  onValueChange={(val) =>
                    setCategory((val ?? "other") as ProductItem["category"])
                  }
                >
                  <SelectTrigger className="w-full bg-muted/30 border-border/50">
                    <SelectValue placeholder="选择商品品类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 卖点描述 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description" className="text-sm font-medium">
                    卖点描述
                  </Label>
                  <span className="text-xs text-muted-foreground">选填</span>
                </div>
                <Textarea
                  id="description"
                  placeholder="描述商品的核心卖点、独特优势..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="bg-muted/30 border-border/50 focus:border-primary resize-none"
                />
              </div>

              {/* 商品图片上传 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-medium">商品图片</Label>
                  <span className="text-xs text-muted-foreground">
                    {images.length}/5 张
                  </span>
                </div>

                {/* 拖拽上传区域 */}
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
                          拖拽图片到这里，或{" "}
                          <span className="brand-gradient-text font-semibold">
                            点击上传
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          支持 JPG / PNG / WebP，最多 5 张
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 已上传图片预览网格 */}
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
                          alt="商品图片"
                          className="h-full w-full object-cover"
                        />
                        {/* 删除按钮 */}
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        >
                          <LuX className="w-3 h-3" />
                        </button>
                        {/* 悬停遮罩 */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 价格信息 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="price" className="text-sm font-medium">
                      价格信息
                    </Label>
                    <span className="text-xs text-muted-foreground">选填</span>
                  </div>
                  <Input
                    id="price"
                    placeholder="例如：¥199"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="bg-muted/30 border-border/50 focus:border-primary"
                  />
                </div>

                {/* 目标人群 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="targetAudience"
                      className="text-sm font-medium"
                    >
                      目标人群
                    </Label>
                    <span className="text-xs text-muted-foreground">选填</span>
                  </div>
                  <Input
                    id="targetAudience"
                    placeholder="例如：18-35岁女性"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="bg-muted/30 border-border/50 focus:border-primary"
                  />
                </div>
              </div>

              {/* 保存/取消按钮 */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={resetForm}>
                  取消
                </Button>
                <Button
                  size="sm"
                  className="brand-gradient text-white"
                  onClick={handleSave}
                  disabled={!name.trim()}
                >
                  {editingId ? "保存修改" : "添加商品"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 商品列表 */}
        {products.length === 0 && !isFormOpen ? (
          // 空状态
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                <LuPackage className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-4">
                还没有商品，添加你的第一个商品
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
                  添加商品
                </Button>
                <Button variant="outline" onClick={importExamples}>
                  导入示例商品
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">没有现成商品？先导入 3 个示例商品试试批量出片</p>
            </CardContent>
          </Card>
        ) : (
          products.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">全部商品</h2>
                <span className="text-sm text-muted-foreground">
                  {products.length} 个商品
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {products.map((product) => (
                  <Card
                    key={product.id}
                    className="card-hover glass-card cursor-pointer group"
                  >
                    <CardContent className="p-0">
                      {/* 商品缩略图 */}
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
                        {/* 品类标签 */}
                        <div className="absolute top-2 left-2">
                          <Badge
                            className={`${
                              categoryColorMap[product.category] || categoryColorMap.other
                            } border-0 text-xs`}
                          >
                            {categoryLabelMap[product.category] || "其他"}
                          </Badge>
                        </div>
                        {/* 悬浮操作按钮 */}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                      {/* 商品信息 */}
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
                            {product.videoCount} 个视频
                          </span>
                        </div>
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
