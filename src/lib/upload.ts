"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

const BUCKET = "avatars";

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^(png|jpe?g|webp|gif)$/.test(fromName)) return fromName;
  if (file.type.includes("png")) return "png";
  if (file.type.includes("webp")) return "webp";
  if (file.type.includes("gif")) return "gif";
  return "jpg";
}

/**
 * アバター画像をSupabase Storageへ保存し、公開URLを返す。
 * 認証済みのユーザーが自分のフォルダ(`<userId>/`)にのみ書き込める。
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  const sb = supabaseBrowser();
  const folder = userId;
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionOf(file)}`;

  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true,
    cacheControl: "3600",
  });

  if (error) {
    throw new Error(
      error.message.includes("Bucket not found")
        ? "アバター用のストレージ(avatars)が未作成です。supabase/schema.sql を適用してください。"
        : `画像のアップロードに失敗しました: ${error.message}`,
    );
  }

  const {
    data: { publicUrl },
  } = sb.storage.from(BUCKET).getPublicUrl(path);

  return publicUrl;
}
