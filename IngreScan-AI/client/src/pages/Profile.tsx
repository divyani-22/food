import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { Trash2, Plus, UserRound, HeartPulse, Pill, Activity } from "lucide-react";
import { PageHeader } from "@/components/brand/PageHeader";
import { StatusTag } from "@/components/brand/StatusTag";
import { WhatsAppCard } from "@/components/features/WhatsAppCard";

// Parse a numeric input to a positive integer, or undefined if empty/invalid
// (the server rejects NaN and the DB columns are integers).
function toInt(v: string): number | undefined {
  const n = Math.round(parseFloat(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function Profile() {
  const { data: profile, refetch: refetchProfile } = trpc.profile.get.useQuery();
  const { data: conditions, refetch: refetchConditions } = trpc.profile.getMedicalConditions.useQuery();
  const { data: medications, refetch: refetchMedications } = trpc.profile.getMedications.useQuery({ currentOnly: false });

  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [exerciseFrequency, setExerciseFrequency] = useState("");
  const [dietType, setDietType] = useState("");

  const [newCondition, setNewCondition] = useState("");
  const [newMedication, setNewMedication] = useState({ name: "", dosage: "", isCurrent: true });

  const upsertProfileMutation = trpc.profile.upsert.useMutation();
  const addConditionMutation = trpc.profile.addMedicalCondition.useMutation();
  const deleteConditionMutation = trpc.profile.deleteMedicalCondition.useMutation();
  const addMedicationMutation = trpc.profile.addMedication.useMutation();
  const deleteMedicationMutation = trpc.profile.deleteMedication.useMutation();

  useEffect(() => {
    if (profile) {
      setAge(profile.age?.toString() || "");
      setGender(profile.gender || "");
      setHeight(profile.height?.toString() || "");
      setWeight(profile.weight?.toString() || "");
      setExerciseFrequency(profile.exerciseFrequency || "");
      setDietType(profile.dietType || "");
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    try {
      await upsertProfileMutation.mutateAsync({
        age: toInt(age),
        gender: (gender || undefined) as any,
        height: toInt(height),
        weight: toInt(weight),
        exerciseFrequency: (exerciseFrequency || undefined) as any,
        dietType: (dietType || undefined) as any,
      });
      toast.success("Profile updated successfully");
      refetchProfile();
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    }
  };

  const handleAddCondition = async () => {
    if (!newCondition.trim()) return;
    try {
      await addConditionMutation.mutateAsync({ condition: newCondition.trim() });
      toast.success("Medical condition added");
      setNewCondition("");
      refetchConditions();
    } catch (error: any) {
      toast.error(error.message || "Failed to add condition");
    }
  };

  const handleDeleteCondition = async (id: number) => {
    try {
      await deleteConditionMutation.mutateAsync({ id });
      toast.success("Condition removed");
      refetchConditions();
    } catch (error: any) {
      toast.error(error.message || "Failed to remove condition");
    }
  };

  const handleAddMedication = async () => {
    if (!newMedication.name.trim()) return;
    try {
      await addMedicationMutation.mutateAsync({
        name: newMedication.name.trim(),
        dosage: newMedication.dosage.trim() || undefined,
        isCurrent: newMedication.isCurrent,
      });
      toast.success("Medication added");
      setNewMedication({ name: "", dosage: "", isCurrent: true });
      refetchMedications();
    } catch (error: any) {
      toast.error(error.message || "Failed to add medication");
    }
  };

  const handleDeleteMedication = async (id: number) => {
    try {
      await deleteMedicationMutation.mutateAsync({ id });
      toast.success("Medication removed");
      refetchMedications();
    } catch (error: any) {
      toast.error(error.message || "Failed to remove medication");
    }
  };

  const hNum = toInt(height);
  const wNum = toInt(weight);
  const bmi = hNum && wNum ? (wNum / Math.pow(hNum / 100, 2)).toFixed(1) : null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Profile"
          title="Health Profile"
          description="Manage your personal and health information"
        />

        <Card>
          <CardHeader>
            <SectionTitle icon={<UserRound className="h-5 w-5 text-ember-orange" />} title="Personal Details" description="Basic information for personalized analysis" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input id="age" type="number" placeholder="25" value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="gender" className="w-full"><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="height">Height (cm)</Label>
                <Input id="height" type="number" placeholder="170" value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weight">Weight (kg)</Label>
                <Input id="weight" type="number" placeholder="70" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
            </div>
            {bmi && (
              <div className="flex items-center gap-4 rounded-2xl bg-fog p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white" aria-hidden="true">
                  <Activity className="h-5 w-5 text-verdant-green" />
                </span>
                <p className="text-sm font-bold text-muted-foreground">Your BMI: <span className="fn-metric ml-1 text-2xl text-graphite">{bmi}</span></p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="space-y-2">
                <Label htmlFor="exercise">Exercise Frequency</Label>
                <Select value={exerciseFrequency} onValueChange={setExerciseFrequency}>
                  <SelectTrigger id="exercise" className="w-full"><SelectValue placeholder="Select frequency" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sedentary">Sedentary</SelectItem>
                    <SelectItem value="light">Light (1-2 days/week)</SelectItem>
                    <SelectItem value="moderate">Moderate (3-5 days/week)</SelectItem>
                    <SelectItem value="active">Active (6-7 days/week)</SelectItem>
                    <SelectItem value="very_active">Very Active (2x per day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="diet">Diet Type</Label>
                <Select value={dietType} onValueChange={setDietType}>
                  <SelectTrigger id="diet" className="w-full"><SelectValue placeholder="Select diet type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="veg">Vegetarian</SelectItem>
                    <SelectItem value="non_veg">Non-Vegetarian</SelectItem>
                    <SelectItem value="vegan">Vegan</SelectItem>
                    <SelectItem value="keto">Keto</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end border-t border-border pt-6">
              <Button onClick={handleSaveProfile} className="w-full sm:w-auto">Save Profile</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={<HeartPulse className="h-5 w-5 text-signal-red-orange" />} title="Medical Conditions" description="Track conditions that may affect food choices" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="e.g., Diabetes, Hypertension" aria-label="Medical condition" value={newCondition} onChange={(e) => setNewCondition(e.target.value)} className="min-w-0 flex-1" />
              <Button variant="dark" size="icon" onClick={handleAddCondition} aria-label="Add condition"><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-2">
              {conditions?.map((condition) => (
                <div key={condition.id} className="flex items-center justify-between gap-3 rounded-2xl bg-fog py-1.5 pl-4 pr-1.5">
                  <span className="min-w-0 break-words font-bold text-graphite">{condition.condition}</span>
                  <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:bg-white hover:text-signal-red-orange" onClick={() => handleDeleteCondition(condition.id)} aria-label={`Remove ${condition.condition}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {(!conditions || conditions.length === 0) && <p className="text-sm text-muted-foreground">No medical conditions added</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={<Pill className="h-5 w-5 text-iris" />} title="Medications" description="Current and past medications" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input placeholder="Medication name" aria-label="Medication name" value={newMedication.name} onChange={(e) => setNewMedication({ ...newMedication, name: e.target.value })} />
              <Input placeholder="Dosage (optional)" aria-label="Dosage" value={newMedication.dosage} onChange={(e) => setNewMedication({ ...newMedication, dosage: e.target.value })} />
              <Button variant="dark" onClick={handleAddMedication}><Plus className="h-4 w-4" />Add</Button>
            </div>
            <div className="space-y-2">
              {medications?.map((med) => (
                <div key={med.id} className="flex items-center justify-between gap-3 rounded-2xl bg-fog py-3 pl-4 pr-1.5">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words font-bold text-graphite">{med.name}</p>
                    {med.dosage && <p className="text-sm text-muted-foreground">{med.dosage}</p>}
                    <StatusTag tone={med.isCurrent ? "positive" : "neutral"} onWhite>{med.isCurrent ? "Current" : "Past"}</StatusTag>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:bg-white hover:text-signal-red-orange" onClick={() => handleDeleteMedication(med.id)} aria-label={`Remove ${med.name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {(!medications || medications.length === 0) && <p className="text-sm text-muted-foreground">No medications added</p>}
            </div>
          </CardContent>
        </Card>

        <WhatsAppCard />
      </div>
    </DashboardLayout>
  );
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 space-y-1">
        <CardTitle className="fn-heading-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </div>
  );
}
