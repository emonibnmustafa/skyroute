import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { addAllowedModel, createClientKey, deleteCombo, deleteProvider, discoverUpstreamModels, listAllowedModels, listCombos, listKeys, listProviders, removeAllowedModel, snapshot, testAllowedModel, toggleAllowedModel, toggleProvider, testProvider, testProviderModel, upsertCombo, upsertProvider, revokeClientKey } from "./gatewayStore";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  gateway: router({
    snapshot: publicProcedure.query(() => snapshot()),
    providers: publicProcedure.query(() => listProviders()),
    saveProvider: publicProcedure.input(z.object({ id: z.string().optional(), name: z.string(), baseUrl: z.string().url(), apiKey: z.string().optional(), modelId: z.string().optional(), modelIds: z.array(z.string()).optional(), timeoutMs: z.number().optional(), enabled: z.boolean().optional() })).mutation(({ input }) => upsertProvider(input)),
    toggleProvider: publicProcedure.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(({ input }) => toggleProvider(input.id, input.enabled)),
    deleteProvider: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => { deleteProvider(input.id); return { success: true }; }),
    testProvider: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => testProvider(input.id)),
    testProviderModel: publicProcedure.input(z.object({ id: z.string(), modelId: z.string() })).mutation(({ input }) => testProviderModel(input.id, input.modelId)),
    discoverModels: publicProcedure.input(z.object({ baseUrl: z.string().url(), apiKey: z.string() })).mutation(({ input }) => discoverUpstreamModels(input.baseUrl, input.apiKey)),
    allowedModels: publicProcedure.query(() => listAllowedModels()),
    addAllowedModel: publicProcedure.input(z.object({ providerId: z.string(), modelId: z.string(), alias: z.string().optional() })).mutation(({ input }) => addAllowedModel(input)),
    removeAllowedModel: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => { removeAllowedModel(input.id); return { success: true }; }),
    toggleAllowedModel: publicProcedure.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(({ input }) => toggleAllowedModel(input.id, input.enabled)),
    testAllowedModel: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => testAllowedModel(input.id)),
    combos: publicProcedure.query(() => listCombos()),
    saveCombo: publicProcedure.input(z.object({ id: z.string().optional(), name: z.string(), alias: z.string(), routes: z.array(z.object({ providerId: z.string(), modelId: z.string() })), enabled: z.boolean().optional() })).mutation(({ input }) => upsertCombo(input)),
    deleteCombo: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => { deleteCombo(input.id); return { success: true }; }),
    keys: publicProcedure.query(() => listKeys()),
    createKey: publicProcedure.input(z.object({ name: z.string() })).mutation(({ input }) => createClientKey(input.name)),
    revokeKey: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => { revokeClientKey(input.id); return { success: true }; }),
    endpoint: publicProcedure.query(() => ({ baseUrl: "http://127.0.0.1:3000", gatewayPath: "/v1", modelsPath: "/v1/models", chatPath: "/v1/chat/completions" })),
  }),
});

export type AppRouter = typeof appRouter;
