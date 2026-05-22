# Channel Strategy And Monetization

## Respuesta corta

No, el workflow anterior no iba a generar por si solo un video profesional y monetizable para YouTube.

Servia como base de orquestacion.

No servia todavia como sistema de produccion real.

## Lo que faltaba

- nicho fijo
- backlog editorial
- historial de temas usados
- control anti-repeticion por tema y por angulo
- subtitulos alineados por palabra
- render cinematografico consistente
- control de copyright/licencias
- QA de monetizacion antes de publicar

## Nicho recomendado

Para un primer canal automatizado con longform, evita nichos demasiado abiertos.

Recomendacion:

- historia, poder, ciencia y tecnologia explicadas con enfoque documental

Subnichos:

- historia de decisiones politicas y militares
- descubrimientos y errores cientificos
- historia de internet y sistemas modernos
- industrias del futuro

## Lo que no debes hacer

- mezclar diez nichos distintos
- publicar temas aleatorios por moda
- hacer videos demasiado parecidos entre si
- usar titulos y miniaturas intercambiables

## Como evitar repeticiones

Debes guardar y consultar como minimo:

- `canonical_topic`
- `niche`
- `angle`
- `uniqueness_hash`
- fecha de publicacion

Y aplicar estas reglas:

- no repetir el mismo `canonical_topic` en 180 dias
- no repetir el mismo `angle` aunque cambie el titulo
- no publicar dos videos seguidos del mismo subnicho si el canal aun es pequeno
- marcar topics candidatos, usados y descartados

## Que significa “profesional” en este proyecto

Para este canal, profesional significa:

- guion largo con estructura de retencion
- voz expresiva y consistente
- visuales con coherencia de marca
- subtitulos bonitos y legibles
- pacing estable
- chapter cards
- thumbnail pensada desde el guion
- descripcion y metadata limpias

## Que significa “monetizable”

No basta con que YouTube acepte el upload.

Monetizable aqui significa:

- sin claims delicados gratuitos
- sin metraje dudoso
- sin reuso obvio de material sin transformar
- sin narracion mecanica o spammy
- con suficiente transformacion editorial

## Workflow profesional recomendado

1. seleccionar nicho del dia
2. elegir topic desde backlog editorial
3. comprobar historial y anti-repeticion
4. research con fuentes
5. outline con hooks y capitulos
6. guion largo final
7. storyboard visual
8. voz por capitulos
9. subtitulos con word timestamps
10. render final
11. QA editorial, visual y monetizacion
12. upload

## Decision importante

El workflow profesional no puede decidir “cualquier tema” cada dia sin memoria.

Necesita memoria editorial.

Por eso en la base de datos ahora conviene guardar:

- `editorial_topics`
- `content_runs`
- `subtitle_segments`
