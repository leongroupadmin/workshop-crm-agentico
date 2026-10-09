import type { StageRow } from "@/lib/crm-data";

/**
 * Las etapas de un `<select>`, agrupadas por embudo.
 *
 * Con un solo embudo sale la lista de siempre: agrupar una sola cosa es ruido.
 * Con dos o más, dos columnas que se llaman igual —"Nuevo lead" en Ventas y en
 * Posventa— son indistinguibles sin el encabezado, y elegir la equivocada manda
 * el lead a otro proceso.
 *
 * Se apoya en que las etapas llegan ordenadas por posición: agruparlas respeta
 * ese orden dentro de cada embudo, y los embudos salen en el orden en que
 * aparece su primera etapa.
 */
export function OpcionesDeEtapa({ stages }: { stages: StageRow[] }) {
  const embudos = [...new Set(stages.map((stage) => stage.pipelineId))];

  if (embudos.length <= 1) {
    return (
      <>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </>
    );
  }

  return (
    <>
      {embudos.map((pipelineId) => {
        const suyas = stages.filter((stage) => stage.pipelineId === pipelineId);
        return (
          <optgroup key={pipelineId} label={suyas[0]?.pipelineName || "Embudo"}>
            {suyas.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/** Si en esta lista conviven columnas de más de un embudo. */
export function hayVariosEmbudos(stages: StageRow[]): boolean {
  return new Set(stages.map((stage) => stage.pipelineId)).size > 1;
}

/**
 * Cómo se nombra una etapa fuera de un selector: en un chip, en una casilla, en
 * un aviso. Con varios embudos hace falta decir de cuál es.
 */
export function nombreCompletoDeEtapa(stage: StageRow, hayVariosEmbudos: boolean): string {
  return hayVariosEmbudos && stage.pipelineName
    ? `${stage.pipelineName} · ${stage.name}`
    : stage.name;
}
