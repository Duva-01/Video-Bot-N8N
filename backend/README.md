# Backend

Esta carpeta arranca deliberadamente minima.

## Que contiene

- configuracion base de entorno
- esquema inicial de base de datos
- blueprint del workflow principal
- punto de apoyo para futuras utilidades de API, workers o scripts

## Enfoque

La primera version del backend no necesita una app Node separada si `n8n` va a hacer de:

- scheduler
- orquestador
- capa de webhooks
- integrador con APIs

Una API propia solo merece la pena cuando necesites:

- panel autenticado real
- endpoints internos
- colas propias
- workers de render
- control fino de publishing y retries

## Siguiente ampliacion logica

Cuando el workflow diario este estable, la siguiente carpeta a crear aqui sera algo como:

```text
backend/api/
backend/db/
backend/scripts/
backend/workers/
```
