import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";


// ============= Input Schemas =============

const userProfileSchema = z.object({
  age: z.number().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  bmi: z.number().optional(),
  exerciseFrequency: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  dietType: z.enum(["veg", "non_veg", "vegan", "keto", "other"]).optional(),
});

const medicalConditionSchema = z.object({
  condition: z.string(),
  diagnosedDate: z.date().optional(),
  notes: z.string().optional(),
});

const medicationSchema = z.object({
  name: z.string(),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  isCurrent: z.boolean().default(true),
  notes: z.string().optional(),
});

const createScanSchema = z.object({
  productName: z.string().optional(),
  inputType: z.enum(["text", "image"]),
  rawIngredients: z.string().optional(),
  imageUrl: z.string().optional(),
  imageKey: z.string().optional(),
});

// ============= Router Definition =============

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ============= User Profile Router =============
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserProfile(ctx.user.id);
    }),

    upsert: protectedProcedure
      .input(userProfileSchema)
      .mutation(async ({ ctx, input }) => {
        // Calculate BMI if height and weight provided
        let bmi = input.bmi;
        if (input.height && input.weight && !bmi) {
          const heightInMeters = input.height / 100;
          bmi = input.weight / (heightInMeters * heightInMeters);
        }

        return db.upsertUserProfile({
          userId: ctx.user.id,
          ...input,
          bmi,
        });
      }),

    getMedicalConditions: protectedProcedure.query(async ({ ctx }) => {
      return db.getMedicalConditions(ctx.user.id);
    }),

    addMedicalCondition: protectedProcedure
      .input(medicalConditionSchema)
      .mutation(async ({ ctx, input }) => {
        return db.addMedicalCondition({
          userId: ctx.user.id,
          ...input,
        });
      }),

    deleteMedicalCondition: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return db.deleteMedicalCondition(input.id, ctx.user.id);
      }),

    getMedications: protectedProcedure
      .input(z.object({ currentOnly: z.boolean().default(false) }))
      .query(async ({ ctx, input }) => {
        return db.getMedications(ctx.user.id, input.currentOnly);
      }),

    addMedication: protectedProcedure
      .input(medicationSchema)
      .mutation(async ({ ctx, input }) => {
        return db.addMedication({
          userId: ctx.user.id,
          ...input,
        });
      }),

    updateMedication: protectedProcedure
      .input(z.object({
        id: z.number(),
        updates: medicationSchema.partial(),
      }))
      .mutation(async ({ ctx, input }) => {
        return db.updateMedication(input.id, ctx.user.id, input.updates);
      }),

    deleteMedication: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return db.deleteMedication(input.id, ctx.user.id);
      }),
  }),

  // ============= Scanner Router =============
  scanner: router({
    uploadImage: protectedProcedure
      .input(z.object({
        fileName: z.string(),
        fileData: z.string(), // base64
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileData, 'base64');
        const fileKey = `scans/${ctx.user.id}/${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        return { url, fileKey };
      }),

    createScan: protectedProcedure
      .input(createScanSchema)
      .mutation(async ({ ctx, input }) => {
        const scanId = await db.createFoodScan({
          userId: ctx.user.id,
          ...input,
        });
        return { scanId };
      }),

    getScan: protectedProcedure
      .input(z.object({ scanId: z.number() }))
      .query(async ({ ctx, input }) => {
        const scan = await db.getFoodScan(input.scanId, ctx.user.id);
        if (!scan) throw new Error("Scan not found");
        
        const ingredients = await db.getScanIngredients(input.scanId);
        const alternatives = await db.getAlternatives(input.scanId);
        
        return { scan, ingredients, alternatives };
      }),

    getUserScans: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        return db.getUserScans(ctx.user.id, input.limit);
      }),

    processOCR: protectedProcedure
      .input(z.object({
        scanId: z.number(),
        imageUrl: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Use LLM with vision to extract ingredients from image
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are an expert at reading food ingredient labels. Extract all ingredients from the image and return them as a comma-separated list."
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Please extract all ingredients from this food label image:"
                },
                {
                  type: "image_url",
                  image_url: {
                    url: input.imageUrl,
                    detail: "high"
                  }
                }
              ]
            }
          ],
        });

        const ocrText = typeof response.choices[0].message.content === 'string'
          ? response.choices[0].message.content
          : JSON.stringify(response.choices[0].message.content);
        
        // Update scan with OCR results
        await db.updateFoodScan(input.scanId, ctx.user.id, {
          ocrText,
          rawIngredients: ocrText,
        });

        return { ocrText };
      }),
  }),

  // ============= Analysis Router =============
  analysis: router({
    analyzeIngredients: protectedProcedure
      .input(z.object({
        scanId: z.number(),
        ingredients: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Get user profile for personalized analysis
        const userProfile = await db.getUserProfile(ctx.user.id);
        const medicalConditions = await db.getMedicalConditions(ctx.user.id);
        const medications = await db.getMedications(ctx.user.id, true);

        // Build context for LLM
        const userContext = {
          profile: userProfile,
          conditions: medicalConditions.map(c => c.condition),
          medications: medications.map(m => m.name),
        };

        // Use LLM to analyze ingredients with Label Padhega India focus
        const analysisPrompt = `Analyze the following food ingredients for health risks, with special focus on consumer awareness and the "Label Padhega India" campaign principles.

User Context:
${JSON.stringify(userContext, null, 2)}

Ingredients:
${input.ingredients}

For each ingredient, provide:
1. Scientific name (if applicable)
2. Category (preservative, sweetener, flavor enhancer, etc.)
3. Risk level (safe, low, moderate, high, severe)
4. Short-term effects
5. Long-term effects
6. Side effects
7. Personalized risk based on user profile
8. Sources (cite WHO, FSSAI, PubMed when applicable)

IMPORTANT - Label Padhega India Focus:
- Identify hidden sugars (including maltodextrin, corn syrup, dextrose, etc.)
- Flag excessive salt/sodium content
- Highlight unhealthy oils and trans fats
- Detect harmful additives and preservatives (E-numbers, artificial colors, etc.)
- Identify misleading marketing claims (e.g., "healthy", "natural", "sugar-free" but high in other sweeteners)
- Special attention to products marketed to children
- Educate about ingredient order (ingredients listed by quantity)

Return the analysis with consumer education focus as a JSON array with this structure:
[{
  "name": "ingredient name",
  "scientificName": "scientific name",
  "category": "category",
  "riskLevel": "safe|low|moderate|high|severe",
  "shortTermEffects": "description",
  "longTermEffects": "description",
  "sideEffects": "description",
  "personalizedRisk": "personalized analysis",
  "sources": ["source1", "source2"]
}]`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a food safety and nutrition expert with knowledge of FSSAI and WHO guidelines." },
            { role: "user", content: analysisPrompt }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "ingredient_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        scientificName: { type: "string" },
                        category: { type: "string" },
                        riskLevel: { type: "string", enum: ["safe", "low", "moderate", "high", "severe"] },
                        shortTermEffects: { type: "string" },
                        longTermEffects: { type: "string" },
                        sideEffects: { type: "string" },
                        personalizedRisk: { type: "string" },
                        sources: { type: "array", items: { type: "string" } }
                      },
                      required: ["name", "scientificName", "category", "riskLevel", "shortTermEffects", "longTermEffects", "sideEffects", "personalizedRisk", "sources"],
                      additionalProperties: false
                    }
                  },
                  overallRiskScore: { type: "number" },
                  summary: { type: "string" }
                },
                required: ["ingredients", "overallRiskScore", "summary"],
                additionalProperties: false
              }
            }
          }
        });

        const content = typeof response.choices[0].message.content === 'string'
          ? response.choices[0].message.content
          : JSON.stringify(response.choices[0].message.content);
        const analysisResult = JSON.parse(content);

        // Save ingredients to database
        for (const ingredient of analysisResult.ingredients) {
          await db.addScanIngredient({
            scanId: input.scanId,
            name: ingredient.name,
            scientificName: ingredient.scientificName,
            category: ingredient.category,
            riskLevel: ingredient.riskLevel as any,
            shortTermEffects: ingredient.shortTermEffects,
            longTermEffects: ingredient.longTermEffects,
            sideEffects: ingredient.sideEffects,
            personalizedRisk: ingredient.personalizedRisk,
            sources: JSON.stringify(ingredient.sources),
          });
        }

        // Update scan with risk score
        await db.updateFoodScan(input.scanId, ctx.user.id, {
          riskScore: Math.round(analysisResult.overallRiskScore),
          analysisComplete: true,
        });

        return analysisResult;
      }),

    suggestAlternatives: protectedProcedure
      .input(z.object({
        scanId: z.number(),
        productName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const scan = await db.getFoodScan(input.scanId, ctx.user.id);
        if (!scan) throw new Error("Scan not found");

        const ingredients = await db.getScanIngredients(input.scanId);
        const userProfile = await db.getUserProfile(ctx.user.id);

        const prompt = `Suggest 3-5 healthier alternatives to "${input.productName}" based on the ingredient analysis and user profile.

User Profile: ${JSON.stringify(userProfile)}
Current Product Risk Score: ${scan.riskScore}
Problematic Ingredients: ${ingredients.filter(i => i.riskLevel && ['moderate', 'high', 'severe'].includes(i.riskLevel)).map(i => i.name).join(', ')}

For each alternative, provide:
1. Product name
2. Reason why it's better
3. Scientific justification
4. Sources

Return as JSON array:
[{
  "productName": "alternative product",
  "reason": "why it's better",
  "scientificJustification": "detailed explanation",
  "sources": ["source1", "source2"]
}]`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a nutrition expert who recommends healthier food alternatives." },
            { role: "user", content: prompt }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "alternatives",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  alternatives: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        productName: { type: "string" },
                        reason: { type: "string" },
                        scientificJustification: { type: "string" },
                        sources: { type: "array", items: { type: "string" } }
                      },
                      required: ["productName", "reason", "scientificJustification", "sources"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["alternatives"],
                additionalProperties: false
              }
            }
          }
        });

        const altContent = typeof response.choices[0].message.content === 'string'
          ? response.choices[0].message.content
          : JSON.stringify(response.choices[0].message.content);
        const result = JSON.parse(altContent);

        // Save alternatives to database
        for (const alt of result.alternatives) {
          await db.addAlternative({
            scanId: input.scanId,
            productName: alt.productName,
            reason: alt.reason,
            scientificJustification: alt.scientificJustification,
            sources: JSON.stringify(alt.sources),
          });
        }

        return result.alternatives;
      }),
  }),

  // ============= Chatbot Router =============
  chat: router({
    sendMessage: protectedProcedure
      .input(z.object({
        message: z.string(),
        scanId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Save user message
        await db.addChatMessage({
          userId: ctx.user.id,
          scanId: input.scanId,
          role: "user",
          content: input.message,
        });

        // Get chat history for context
        const history = await db.getChatHistory(ctx.user.id, input.scanId, 20);
        
        // Get user context
        const userProfile = await db.getUserProfile(ctx.user.id);
        const medicalConditions = await db.getMedicalConditions(ctx.user.id);
        const medications = await db.getMedications(ctx.user.id, true);

        // Get scan context if provided
        let scanContext = "";
        if (input.scanId) {
          const scan = await db.getFoodScan(input.scanId, ctx.user.id);
          const ingredients = await db.getScanIngredients(input.scanId);
          scanContext = `\n\nCurrent Scan Context:\nProduct: ${scan?.productName || 'Unknown'}\nIngredients: ${ingredients.map(i => i.name).join(', ')}`;
        }

        const systemPrompt = `You are a food safety and nutrition expert chatbot supporting the "Label Padhega India" consumer awareness movement. You ONLY answer questions about food, ingredients, nutrition, and health impacts of food products.

User Profile:
- Diet Type: ${userProfile?.dietType || 'Not specified'}
- Medical Conditions: ${medicalConditions.map(c => c.condition).join(', ') || 'None'}
- Current Medications: ${medications.map(m => m.name).join(', ') || 'None'}
${scanContext}

Guidelines:
1. Only answer food-related questions
2. Provide scientific explanations when discussing ingredients
3. Consider the user's profile in your responses
4. Cite sources (WHO, FSSAI, PubMed) when making health claims
5. If asked about non-food topics, politely redirect to food-related queries

Label Padhega India Focus:
- Educate about hidden ingredients (sugars, salts, oils, additives)
- Expose misleading marketing claims ("healthy", "natural", "sugar-free")
- Explain how to read ingredient labels properly
- Highlight risks in products marketed to children
- Empower consumers to make informed choices
- Promote food literacy and transparency

Be helpful, accurate, educational, and personalized to the user's health profile.`;

        // Build message history for LLM
        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...history.slice(-10).map(h => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
        ];

        const response = await invokeLLM({ messages });
        const assistantMessage = typeof response.choices[0].message.content === 'string' 
          ? response.choices[0].message.content 
          : JSON.stringify(response.choices[0].message.content);

        // Save assistant message
        await db.addChatMessage({
          userId: ctx.user.id,
          scanId: input.scanId,
          role: "assistant",
          content: assistantMessage,
        });

        return { message: assistantMessage };
      }),

    getHistory: protectedProcedure
      .input(z.object({
        scanId: z.number().optional(),
        limit: z.number().default(100),
      }))
      .query(async ({ ctx, input }) => {
        return db.getChatHistory(ctx.user.id, input.scanId, input.limit);
      }),
  }),


});

export type AppRouter = typeof appRouter;
