import { z } from "zod";
import { createMaddixSession, clearMaddixSession, hasMaddixSession, setMaddixSession } from "./auth";
import { ensureMaddixSeed, createOrder, createMaterial, deleteMaterial, deletePreparedOrder, getOrCreateLocalUser, getOrderDetails, getStats, getUserByEmail, listMaterials, listNotifications, listOrders, listUsers, markNotificationRead, deleteNotification, deleteUser, setUserActive, updateMaterial, updateOrderItemPreparation, updateOrderStatus, verifyPassword } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import type { User } from "../drizzle/schema";

const statusSchema = z.enum(["NEW", "PROCESSING", "READY", "DELIVERED", "REJECTED"]);
const packagingTypeSchema = z.enum(["CARTON", "BAG", "JERRY_CAN"]);
const toPublicUser = (user: User) => {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
};

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية الإدارة" });
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user ? toPublicUser(ctx.user) : null),
    login: publicProcedure.input(z.object({ name: z.string().trim().min(2).max(160), email: z.string().email(), password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
      await ensureMaddixSeed();
      const existing = await getUserByEmail(input.email);
      let user;
      if (existing?.role === "admin") {
        if (!existing.active || !verifyPassword(input.password, existing.passwordHash)) throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات الدخول غير صحيحة" });
        user = existing;
      } else {
        try { user = await getOrCreateLocalUser(input); }
        catch (error) {
          if (error instanceof Error && error.message === "DATABASE_UNAVAILABLE") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
          if (error instanceof Error && error.message === "USER_INACTIVE") throw new TRPCError({ code: "FORBIDDEN", message: "هذا الحساب معطل، تواصل مع مسؤول النظام" });
          if (error instanceof Error && error.message === "INVALID_CREDENTIALS") throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات الدخول غير صحيحة" });
          throw new TRPCError({ code: "UNAUTHORIZED", message: "تعذر تسجيل الدخول" });
        }
      }
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "تعذر إنشاء الحساب" });
      const token = await createMaddixSession(user);
      setMaddixSession(ctx.res, ctx.req, token);
      return { success: true, user: toPublicUser(user) };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      if (hasMaddixSession(ctx.req)) clearMaddixSession(ctx.res, ctx.req);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  materials: router({
    list: protectedProcedure.input(z.object({ search: z.string().optional(), includeInactive: z.boolean().optional() }).optional()).query(async ({ input, ctx }) => {
      await ensureMaddixSeed();
      return listMaterials(input?.search, ctx.user.role === "admin" && input?.includeInactive === true);
    }),
    create: adminProcedure.input(z.object({ name: z.string().trim().min(1).max(160), packagingType: packagingTypeSchema })).mutation(async ({ input, ctx }) => createMaterial({ name: input.name, packagingType: input.packagingType, createdBy: ctx.user.id })),
    update: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(160), packagingType: packagingTypeSchema })).mutation(({ input }) => updateMaterial({ id: input.id, name: input.name, packagingType: input.packagingType })),
    remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteMaterial(input.id)),
  }),
  orders: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["ALL", "NEW", "PROCESSING", "READY", "DELIVERED", "REJECTED"]).optional() }).optional()).query(({ input, ctx }) => listOrders(ctx.user.role === "admin" ? undefined : ctx.user.id, input?.status)),
    details: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      const result = await getOrderDetails(input.orderId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
      if (ctx.user.role !== "admin" && result.order.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك الوصول لهذا الطلب" });
      if (ctx.user.role !== "admin") {
        return {
          ...result,
          items: result.items.map(item => {
            const { preparedAt: _preparedAt, preparedBy: _preparedBy, ...safeItem } = item;
            return {
              ...safeItem,
              status: item.status === "PREPARED" ? "PREPARING" as const : item.status,
            };
          }),
        };
      }
      return result;
    }),
    create: protectedProcedure.input(z.object({ notes: z.string().max(1000).optional(), idempotencyKey: z.string().trim().min(16).max(96).optional(), items: z.array(z.object({ materialId: z.number().int().positive(), quantity: z.number().finite().positive().max(2147483647) })).min(1).max(50) })).mutation(async ({ input, ctx }) => {
      try {
        return await createOrder({ userId: ctx.user.id, notes: input.notes, idempotencyKey: input.idempotencyKey, items: input.items });
      } catch (error) {
        const code = error instanceof Error ? error.message : "DATABASE_ERROR";
        if (code === "INVALID_MATERIAL" || code === "INVALID_QUANTITY" || code === "DUPLICATE_ORDER_ITEM") throw new TRPCError({ code: "BAD_REQUEST", message: "تحقق من الخامات والكميات المطلوبة وعدم تكرار الخامة" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء الطلب الآن" });
      }
    }),
    changeStatus: adminProcedure.input(z.object({ orderId: z.number().int().positive(), status: statusSchema })).mutation(async ({ input, ctx }) => {
      try { return await updateOrderStatus(input.orderId, input.status, ctx.user.id); }
      catch (error) {
        const code = error instanceof Error ? error.message : "DATABASE_ERROR";
        if (code === "INVALID_STATUS_TRANSITION") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن الانتقال إلى هذه الحالة" });
        if (code === "ITEMS_NOT_PREPARED") throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تجهيز كل الخامات أولًا قبل اعتماد الطلب" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر تحديث حالة الطلب" });
      }
    }),
    prepareItem: adminProcedure.input(z.object({ itemId: z.number().int().positive(), status: z.enum(["PREPARING", "PREPARED"]) })).mutation(async ({ input, ctx }) => {
      try { return await updateOrderItemPreparation(input.itemId, input.status, ctx.user.id); }
      catch (error) {
        if (error instanceof Error && error.message === "INVALID_ITEM_STATUS_TRANSITION") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن الانتقال إلى حالة التحضير المطلوبة" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر تحديث حالة التجهيز، حاول مرة أخرى." });
      }
    }),
    deletePreparedOrder: adminProcedure.input(z.object({ orderId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      try { return await deletePreparedOrder(input.orderId, ctx.user.id); }
      catch (error) {
        const code = error instanceof Error ? error.message : "DATABASE_ERROR";
        if (code === "ONLY_PREPARED_ORDERS_CAN_BE_DELETED") throw new TRPCError({ code: "BAD_REQUEST", message: "يمكن حذف الطلب بعد إتمام تحضيره فقط" });
        if (code === "ORDER_NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND", message: "الطلب غير موجود" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر حذف الطلب، حاول مرة أخرى." });
      }
    }),
  }),
  stats: router({
    mine: protectedProcedure.query(async ({ ctx }) => { await ensureMaddixSeed(); return getStats(ctx.user.role === "admin" ? undefined : ctx.user.id); }),
  }),
  notifications: router({
    list: adminProcedure.query(({ ctx }) => listNotifications(ctx.user.id)),
    markRead: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input, ctx }) => markNotificationRead(input.id, ctx.user.id)),
    remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input, ctx }) => deleteNotification(input.id, ctx.user.id)),
  }),
  users: router({
    list: adminProcedure.query(() => listUsers()),
    setActive: adminProcedure.input(z.object({ userId: z.number().int().positive(), active: z.boolean() })).mutation(async ({ input, ctx }) => {
      try { return await setUserActive(input.userId, input.active, ctx.user.id); }
      catch (error) {
        if (error instanceof Error && error.message === "CANNOT_DEACTIVATE_SELF") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك تعطيل حسابك" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر تحديث حالة المستخدم" });
      }
    }),    remove: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      try { return await deleteUser(input.userId, ctx.user.id); }
      catch (error) {
        if (error instanceof Error && error.message === "CANNOT_DELETE_SELF") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك حذف حسابك" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر حذف المستخدم" });
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
