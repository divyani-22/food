import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Barcode,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Plus,
  Refrigerator,
  Search,
  Snowflake,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "Dairy", label: "Dairy & Eggs", icon: "🥛" },
  { value: "Produce", label: "Fruits & Vegetables", icon: "🥦" },
  { value: "Meat", label: "Meat & Seafood", icon: "🥩" },
  { value: "Grains", label: "Bakery & Grains", icon: "🍞" },
  { value: "Snacks", label: "Snacks & Packaged", icon: "🍪" },
  { value: "Beverages", label: "Beverages", icon: "🧃" },
  { value: "Condiments", label: "Sauces & Condiments", icon: "🥫" },
  { value: "Other", label: "Other", icon: "🍽️" },
];

const PRESETS = [
  { title: "Fresh Milk", category: "Dairy", storageLocation: "fridge", days: 5, icon: "🥛" },
  { title: "Whole Wheat Bread", category: "Grains", storageLocation: "pantry", days: 6, icon: "🍞" },
  { title: "Greek Yogurt", category: "Dairy", storageLocation: "fridge", days: 12, icon: "🥣" },
  { title: "Eggs (Dozen)", category: "Dairy", storageLocation: "fridge", days: 21, icon: "🥚" },
  { title: "Apples", category: "Produce", storageLocation: "fridge", days: 14, icon: "🍎" },
  { title: "Cheddar Cheese", category: "Dairy", storageLocation: "fridge", days: 25, icon: "🧀" },
];

export default function FridgeTracker() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.inventory.list.useQuery();

  const addMutation = trpc.inventory.add.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      toast.success("Food item added to tracker!");
      setIsAddOpen(false);
      resetForm();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add food item");
    },
  });

  const consumeMutation = trpc.inventory.consume.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      toast.success("Marked as consumed! Zero food waste 🎉");
    },
  });

  const deleteMutation = trpc.inventory.delete.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      toast.success("Item removed from tracker");
    },
  });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [activeLocation, setActiveLocation] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Dairy");
  const [quantity, setQuantity] = useState("1");
  const [storageLocation, setStorageLocation] = useState<"fridge" | "freezer" | "pantry">("fridge");
  const [foodImageUrl, setFoodImageUrl] = useState("");
  const [barcode, setBarcode] = useState("");
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setTitle("");
    setCategory("Dairy");
    setQuantity("1");
    setStorageLocation("fridge");
    setFoodImageUrl("");
    setBarcode("");
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setExpiryDate(d.toISOString().split("T")[0]);
    setNotes("");
  };

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    setTitle(preset.title);
    setCategory(preset.category);
    setStorageLocation(preset.storageLocation as any);
    const d = new Date();
    d.setDate(d.getDate() + preset.days);
    setExpiryDate(d.toISOString().split("T")[0]);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a food title");
      return;
    }
    addMutation.mutate({
      title: title.trim(),
      category,
      quantity: quantity.trim() || "1",
      storageLocation,
      foodImageUrl: foodImageUrl.trim() || undefined,
      barcode: barcode.trim() || undefined,
      expiryDate,
      notes: notes.trim() || undefined,
    });
  };

  // Filtered Items
  const activeItems = useMemo(() => {
    return items.filter((item) => item.status !== "consumed");
  }, [items]);

  const filteredItems = useMemo(() => {
    return activeItems.filter((item) => {
      const matchesLocation =
        activeLocation === "all" || item.storageLocation === activeLocation;
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;
      const matchesSearch =
        !searchQuery.trim() ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesLocation && matchesCategory && matchesSearch;
    });
  }, [activeItems, activeLocation, selectedCategory, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = activeItems.length;
    const fresh = activeItems.filter((i) => i.status === "fresh").length;
    const expiringSoon = activeItems.filter((i) => i.status === "expiring_soon").length;
    const expired = activeItems.filter((i) => i.status === "expired").length;
    return { total, fresh, expiringSoon, expired };
  }, [activeItems]);

  const getCategoryIcon = (catName: string) => {
    const match = CATEGORIES.find((c) => c.value.toLowerCase() === catName.toLowerCase());
    return match ? match.icon : "🍽️";
  };

  return (
    <DashboardLayout>
      <div className="container py-8 space-y-8 max-w-7xl">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl">🥦❄️</span>
              <h1 className="text-3xl font-bold tracking-tight">Food Expiry Tracker</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              Smart fridge & pantry management. Track expiry dates, eliminate food waste, and save money.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/openfoodfacts">
              <Button variant="outline" className="gap-2">
                <Barcode className="h-4 w-4 text-emerald-600" />
                Scan Barcode
              </Button>
            </Link>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4" />
                  Add Food Item
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <form onSubmit={handleAddItem}>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Refrigerator className="h-5 w-5 text-emerald-600" />
                      Add Food to Tracker
                    </DialogTitle>
                    <DialogDescription>
                      Enter your item details or pick a quick preset below.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    {/* Quick Presets */}
                    <div>
                      <Label className="text-xs text-muted-foreground">Quick Presets</Label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {PRESETS.map((p) => (
                          <Button
                            key={p.title}
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleApplyPreset(p)}
                          >
                            <span>{p.icon}</span> {p.title}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="item-title">Food Name *</Label>
                        <Input
                          id="item-title"
                          placeholder="e.g., Amul Pasteurized Butter"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Category</Label>
                        <Select value={category} onValueChange={setCategory}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((cat) => (
                              <SelectItem key={cat.value} value={cat.value}>
                                {cat.icon} {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Storage Location</Label>
                        <Select
                          value={storageLocation}
                          onValueChange={(val: any) => setStorageLocation(val)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fridge">❄️ Refrigerator</SelectItem>
                            <SelectItem value="freezer">🧊 Deep Freezer</SelectItem>
                            <SelectItem value="pantry">🥫 Dry Pantry</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="item-qty">Quantity</Label>
                        <Input
                          id="item-qty"
                          placeholder="e.g. 500g, 1 pack"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="item-expiry">Expiry Date *</Label>
                        <Input
                          id="item-expiry"
                          type="date"
                          value={expiryDate}
                          onChange={(e) => setExpiryDate(e.target.value)}
                          required
                        />
                      </div>

                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="item-image">Image URL (Optional)</Label>
                        <Input
                          id="item-image"
                          placeholder="https://..."
                          value={foodImageUrl}
                          onChange={(e) => setFoodImageUrl(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="item-notes">Notes / Brand</Label>
                        <Textarea
                          id="item-notes"
                          placeholder="e.g., Purchased from store, opened on Monday"
                          rows={2}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAddOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={addMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {addMutation.isPending ? "Adding..." : "Save to Tracker"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase font-semibold">Total Tracked</CardDescription>
              <CardTitle className="text-3xl flex items-center justify-between">
                {stats.total}
                <UtensilsCrossed className="h-5 w-5 text-blue-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Active in your kitchen</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-500">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase font-semibold">Fresh & Good</CardDescription>
              <CardTitle className="text-3xl flex items-center justify-between text-emerald-600">
                {stats.fresh}
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">&gt; 3 days of safe shelf life</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase font-semibold">Expiring Soon</CardDescription>
              <CardTitle className="text-3xl flex items-center justify-between text-amber-600">
                {stats.expiringSoon}
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Consume within 3 days!</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-rose-500">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase font-semibold">Expired</CardDescription>
              <CardTitle className="text-3xl flex items-center justify-between text-rose-600">
                {stats.expired}
                <Flame className="h-5 w-5 text-rose-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Passed expiry date</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center bg-card p-4 rounded-xl border">
          <Tabs
            value={activeLocation}
            onValueChange={setActiveLocation}
            className="w-full md:w-auto"
          >
            <TabsList className="grid grid-cols-4 w-full md:w-auto">
              <TabsTrigger value="all">All Storage</TabsTrigger>
              <TabsTrigger value="fridge" className="gap-1">
                <Snowflake className="h-3.5 w-3.5" /> Fridge
              </TabsTrigger>
              <TabsTrigger value="freezer" className="gap-1">
                🧊 Freezer
              </TabsTrigger>
              <TabsTrigger value="pantry" className="gap-1">
                🥫 Pantry
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 md:w-60">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search food item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.icon} {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Food Items List */}
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            Loading food inventory...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-16 px-4 bg-muted/30 rounded-2xl border border-dashed border-muted-foreground/30 space-y-4">
            <div className="text-5xl">🥗</div>
            <h3 className="text-xl font-bold">No food items found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {searchQuery || selectedCategory !== "all" || activeLocation !== "all"
                ? "Try clearing your filters or search query to see your items."
                : "Your tracker is empty! Start logging items to track freshness and receive expiration alerts."}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button
                onClick={() => setIsAddOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 gap-2"
              >
                <Plus className="h-4 w-4" /> Add Food Item
              </Button>
              <Link href="/openfoodfacts">
                <Button variant="outline" className="gap-2">
                  <Barcode className="h-4 w-4" /> Lookup Barcode
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item: any) => {
              const daysLeft = item.daysLeft ?? 0;
              const isExpired = item.status === "expired" || daysLeft <= 0;
              const isExpiringSoon = !isExpired && (item.status === "expiring_soon" || daysLeft <= 3);

              return (
                <Card
                  key={item.id}
                  className={`overflow-hidden transition-all hover:shadow-md flex flex-col justify-between border ${
                    isExpired
                      ? "border-rose-300 dark:border-rose-900 bg-rose-50/20"
                      : isExpiringSoon
                      ? "border-amber-300 dark:border-amber-900 bg-amber-50/20"
                      : "border-border"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {item.foodImageUrl ? (
                          <img
                            src={item.foodImageUrl}
                            alt={item.title}
                            className="h-14 w-14 rounded-lg object-cover border bg-muted"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center text-2xl border">
                            {getCategoryIcon(item.category)}
                          </div>
                        )}
                        <div>
                          <CardTitle className="text-base font-bold line-clamp-1">
                            {item.title}
                          </CardTitle>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs font-normal">
                              {item.category}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Qty: {item.quantity}
                            </span>
                          </div>
                        </div>
                      </div>

                      <Badge
                        variant={
                          isExpired
                            ? "destructive"
                            : isExpiringSoon
                            ? "default"
                            : "secondary"
                        }
                        className={`text-xs capitalize font-medium ${
                          isExpiringSoon ? "bg-amber-500 hover:bg-amber-600 text-white" : ""
                        }`}
                      >
                        {item.storageLocation === "fridge"
                          ? "❄️ Fridge"
                          : item.storageLocation === "freezer"
                          ? "🧊 Freezer"
                          : "🥫 Pantry"}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3">
                    {/* Expiry Countdown Tag */}
                    <div
                      className={`p-2.5 rounded-lg flex items-center justify-between text-xs font-semibold ${
                        isExpired
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                          : isExpiringSoon
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {isExpired
                          ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago`
                          : daysLeft === 0
                          ? "Expires Today!"
                          : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                      </span>
                      <span className="text-[11px] font-normal opacity-80">
                        {new Date(item.expiryDate).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>

                    {item.notes && (
                      <p className="text-xs text-muted-foreground line-clamp-2 italic">
                        &ldquo;{item.notes}&rdquo;
                      </p>
                    )}
                  </CardContent>

                  {/* Actions */}
                  <div className="p-3 pt-0 border-t bg-muted/20 flex items-center justify-between gap-2 mt-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1 h-8"
                      onClick={() => consumeMutation.mutate({ id: item.id })}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Consumed
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1 h-8 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setLocation(`/scanner?prefill=${encodeURIComponent(item.title)}`);
                        }}
                      >
                        Scan <ExternalLink className="h-3 w-3" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => deleteMutation.mutate({ id: item.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
