"use client";

import { Building2, KeyRound, LogIn, LogOut, ShieldAlert, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { BrandMark } from "@/components/brand";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { WorkspaceContext } from "@/lib/workspace";

const FIELD_CLASS =
  "mt-2 w-full rounded-xl border border-[#ddd8c9] bg-[#f9f8f3] px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-white/5";

/** Pantalla de acceso: ingreso con contraseña y creación del primer workspace. */
export function AuthGate({
  context,
  authError,
}: {
  context: WorkspaceContext;
  authError: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (context.status === "configuration-missing") return;

    const client = getSupabaseBrowser();
    const { data } = client.auth.onAuthStateChange(() => router.refresh());
    return () => data.subscription.unsubscribe();
  }, [context.status, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#eae5d6] p-5 text-neutral-900 dark:bg-[#100d08] dark:text-neutral-100">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <BrandMark className="size-11" />
          <div>
            <p className="text-lg font-semibold">Kivo</p>
            <p className="text-xs text-neutral-500">CRM agéntico multicanal</p>
          </div>
        </div>

        {authError && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-[#ddd8c9] bg-[#f9f8f3] p-6 shadow-sm dark:border-white/10 dark:bg-[#1c1811]">
          {context.status === "configuration-missing" ? (
            <div>
              <h1 className="text-lg font-semibold">Estás viendo el CRM en modo demo</h1>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                Configurá <code>NEXT_PUBLIC_SUPABASE_URL</code> y <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> para conectar usuarios, contactos y métricas reales.
              </p>
            </div>
          ) : context.status === "signed-out" ? (
            <SignIn />
          ) : context.status === "no-access" ? (
            <NoAccess email={context.userEmail} />
          ) : (
            <CreateWorkspace email={context.userEmail} />
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Ingreso con mail y contraseña.
 *
 * Antes era un magic link. El enlace obligaba a abrir el correo en el mismo
 * dispositivo desde el que se entraba, y en el teléfono eso es saltar de app en
 * app cada vez. La contraseña se escribe y listo, que es lo que se espera de un
 * CRM que se abre diez veces por día.
 *
 * Las cuentas se crean en Supabase (Authentication → Users), con mail y
 * contraseña. Acá no hay registro: un mail que nadie dio de alta no tiene con
 * qué entrar.
 */
function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const ingresar = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");

    const { error: signInError } = await getSupabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setPending(false);

    if (signInError) {
      // El mensaje de Supabase es el mismo para mail inexistente y contraseña
      // equivocada, y es a propósito: decir cuál de los dos falló le confirma a
      // un desconocido qué mails tienen cuenta.
      setError(
        /invalid login credentials/i.test(signInError.message)
          ? "Mail o contraseña incorrectos."
          : signInError.message,
      );
      return;
    }

    // El listener de `onAuthStateChange` también refresca, pero pedirlo acá
    // hace que la pantalla cambie apenas vuelve la respuesta.
    router.refresh();
  };

  return (
    <form onSubmit={ingresar}>
      <h1 className="text-lg font-semibold">Ingresá a tu CRM</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Acceso restringido. Entrá con el mail y la contraseña que te dio el administrador.
      </p>

      <label htmlFor="crm-email" className="mt-5 block text-sm font-medium">
        Email
      </label>
      <input
        id="crm-email"
        required
        autoFocus
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="tu@email.com"
        className={FIELD_CLASS}
      />

      <label htmlFor="crm-password" className="mt-4 block text-sm font-medium">
        Contraseña
      </label>
      <input
        id="crm-password"
        required
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="••••••••"
        className={FIELD_CLASS}
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        disabled={pending}
        className="mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogIn className="size-4" />
        {pending ? "Entrando…" : "Entrar"}
      </button>

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-neutral-500">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" />
        <span>
          ¿Olvidaste la contraseña? Pedile a quien administra el CRM que te la cambie en Supabase.
        </span>
      </p>
    </form>
  );
}

/**
 * Sesión válida pero sin membresía, y el alta automática tampoco pudo dársela.
 *
 * Es la salida de excepción: normalmente cualquier cuenta que entra queda como
 * operario sin permisos. Si se llega hasta acá, algo falló —la base no aceptó
 * el alta, o no se pudo resolver el workspace—, así que se dice y se ofrece
 * salir, en vez de mostrar un CRM a medias.
 *
 * Acá antes se ofrecía crear un workspace nuevo. Era la peor salida posible:
 * quien entraba con el mail equivocado terminaba dentro de un CRM vacío y creía
 * que se le habían borrado los chats y las instrucciones de los agentes, cuando
 * en realidad estaba parado en otro lado.
 */
function NoAccess({ email }: { email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const salir = async () => {
    setPending(true);
    await getSupabaseBrowser().auth.signOut();
    router.refresh();
  };

  return (
    <div>
      <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
        <ShieldAlert className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Este mail no tiene acceso</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Entraste como <strong className="text-neutral-700 dark:text-neutral-200">{email}</strong>, pero no se te pudo dar
        acceso al CRM. Probá recargar la página; si sigue igual, pedile a quien administra el CRM
        que revise tu cuenta en Supabase.
      </p>

      <button
        onClick={salir}
        disabled={pending}
        className="mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOut className="size-4" />
        {pending ? "Saliendo…" : "Salir y probar con otro mail"}
      </button>
    </div>
  );
}

/**
 * Creación del workspace. Sólo se llega acá en una instalación nueva, cuando
 * todavía no existe ninguno: el servidor rechaza cualquier intento posterior.
 */
function CreateWorkspace({ email }: { email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");

    const client = getSupabaseBrowser();
    const {
      data: { session },
    } = await client.auth.getSession();

    if (!session) {
      setPending(false);
      return setError("Tu sesión venció. Ingresá nuevamente.");
    }

    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name: name.trim() }),
    });
    const payload = await response.json().catch(() => ({}));

    setPending(false);
    if (!response.ok) return setError(payload.error ?? "No se pudo crear el workspace.");
    router.refresh();
  };

  return (
    <form onSubmit={create}>
      <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
        <Building2 className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Creá tu workspace</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Entraste como <strong className="text-neutral-700 dark:text-neutral-200">{email}</strong>. El workspace agrupa tus
        contactos, conversaciones y oportunidades.
      </p>

      <label htmlFor="workspace" className="mt-5 block text-sm font-medium">
        Nombre del workspace
      </label>
      <input
        id="workspace"
        required
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="León Group"
        className={FIELD_CLASS}
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        disabled={pending}
        className="mt-5 w-full cursor-pointer rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creando…" : "Crear workspace"}
      </button>
    </form>
  );
}
