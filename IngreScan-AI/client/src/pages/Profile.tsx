import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

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
        age: age ? parseInt(age) : undefined,
        gender: gender as any,
        height: height ? parseInt(height) : undefined,
        weight: weight ? parseInt(weight) : undefined,
        exerciseFrequency: exerciseFrequency as any,
        dietType: dietType as any,
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
      await addConditionMutation.mutateAsync({ condition: newCondition });
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
      await addMedicationMutation.mutateAsync(newMedication);
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

  const bmi = height && weight ? (parseInt(weight) / Math.pow(parseInt(height) / 100, 2)).toFixed(1) : null;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Health Profile</h1>
          <p className="text-muted-foreground mt-2">Manage your personal and health information</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Personal Details</CardTitle>
            <CardDescription>Basic information for personalized analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input id="age" type="number" placeholder="25" value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
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
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Your BMI: <span className="text-lg font-bold text-foreground">{bmi}</span></p>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="exercise">Exercise Frequency</Label>
                <Select value={exerciseFrequency} onValueChange={setExerciseFrequency}>
                  <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Select diet type" /></SelectTrigger>
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
            <Button onClick={handleSaveProfile}>Save Profile</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Medical Conditions</CardTitle>
            <CardDescription>Track conditions that may affect food choices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="e.g., Diabetes, Hypertension" value={newCondition} onChange={(e) => setNewCondition(e.target.value)} />
              <Button onClick={handleAddCondition}><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-2">
              {conditions?.map((condition) => (
                <div key={condition.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span>{condition.condition}</span>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteCondition(condition.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {(!conditions || conditions.length === 0) && <p className="text-sm text-muted-foreground">No medical conditions added</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Medications</CardTitle>
            <CardDescription>Current and past medications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-2">
              <Input placeholder="Medication name" value={newMedication.name} onChange={(e) => setNewMedication({ ...newMedication, name: e.target.value })} />
              <Input placeholder="Dosage (optional)" value={newMedication.dosage} onChange={(e) => setNewMedication({ ...newMedication, dosage: e.target.value })} />
              <Button onClick={handleAddMedication}><Plus className="h-4 w-4 mr-2" />Add</Button>
            </div>
            <div className="space-y-2">
              {medications?.map((med) => (
                <div key={med.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">{med.name}</p>
                    {med.dosage && <p className="text-sm text-muted-foreground">{med.dosage}</p>}
                    <p className="text-xs text-muted-foreground">{med.isCurrent ? "Current" : "Past"}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteMedication(med.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {(!medications || medications.length === 0) && <p className="text-sm text-muted-foreground">No medications added</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
