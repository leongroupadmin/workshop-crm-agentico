import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = await request.json().catch(() => null);
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";

  if (!token || !name || name.length > 80) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth.user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const { data: existing } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  if (existing) return NextResponse.json({ workspaceId: existing.workspace_id });

  // El CRM es de una sola empresa: un workspace y todos adentro. Crear uno sólo
  // se permite en la instalación nueva, cuando todavía no hay ninguno.
  //
  // Sin esta guarda, cualquiera con sesión y sin alta se armaba su propio CRM
  // vacío desde la pantalla de ingreso y creía que había perdido los chats y
  // las instrucciones de los agentes, cuando en realidad estaba mirando otro
  // workspace. Ahora el alta es crear la cuenta en Supabase.
  const { data: yaInstalado } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (yaInstalado) {
    return NextResponse.json(
      {
        error:
          "El CRM ya está instalado. Pedile a quien lo administra que cree tu cuenta en Supabase.",
      },
      { status: 409 },
    );
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from("workspaces")
    .insert({ name })
    .select("id, name")
    .single();

  if (workspaceError || !workspace) {
    return NextResponse.json({ error: "No se pudo crear el workspace." }, { status: 500 });
  }

  const { error: memberError } = await supabaseAdmin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: auth.user.id, role: "owner" });

  if (memberError) {
    await supabaseAdmin.from("workspaces").delete().eq("id", workspace.id);
    return NextResponse.json({ error: "No se pudo asociar el usuario al workspace." }, { status: 500 });
  }

  return NextResponse.json({ workspaceId: workspace.id, name: workspace.name }, { status: 201 });
}
