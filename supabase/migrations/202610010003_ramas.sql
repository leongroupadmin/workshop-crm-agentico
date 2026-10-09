-- Ramas: una automatización deja de ser una lista y pasa a ser un árbol.
--
-- Los pasos ya vivían en jsonb, así que el árbol entra ahí sin tocar el
-- esquema: una condición es un paso más, con dos listas de pasos adentro. Lo
-- que no entra es el cursor de la corrida. `automation_runs.paso` es el índice
-- dentro de la lista, y un índice no alcanza para decir "el segundo paso de la
-- rama del sí de la tercera condición".
--
-- Por eso la ruta, que es ese camino escrito: `2.si.1`. Índice, rama, índice,
-- y siempre termina en índice.
--
-- Nullable y sin default a propósito. Null quiere decir "esta corrida es de
-- antes de que existieran las ramas", y el motor la lee del índice de siempre.
-- Si en vez de eso la columna naciera con `''`, las corridas que estaban en
-- vuelo durante el deploy —un follow-up de 48 horas a mitad de camino— se
-- leerían como si estuvieran en la posición inicial y volverían a mandar los
-- mensajes que ya mandaron.
--
-- `paso` se sigue escribiendo con el índice del nivel de arriba. No lo lee
-- nadie más una vez que hay ruta, pero deja la fila legible mirándola a mano y
-- permite volver atrás el deploy sin que las corridas en curso queden mudas.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table public.automation_runs
  add column if not exists ruta text;

comment on column public.automation_runs.ruta is
  'Por dónde va la corrida dentro del árbol de pasos: "2.si.1". Null: corrida anterior a las ramas, se usa `paso`.';
