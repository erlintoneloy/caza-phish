# 🎣 CazaPhish - Motor de Detección de Phishing con IA

![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=Cloudflare&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-FF5D01?style=for-the-badge&logo=astro&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

**CazaPhish** es una plataforma B2B/B2G diseñada para proteger a los funcionarios públicos contra ataques de ingeniería social potenciados por Inteligencia Artificial. Utiliza modelos de lenguaje avanzados en el Edge de Cloudflare para analizar correos sospechosos y emitir alertas explicables en milisegundos.

## 🚀 Demo Funcional
Prueba la aplicación en vivo aquí: [https://caza-phish.workers.dev](https://caza-phish.workers.dev) *(Enlace de producción)*

## 🧠 Uso de IA y Ética
- **Modelo:** `@cf/meta/llama-3.1-8b-instruct-fast` en Cloudflare Workers AI.
- **Explicabilidad:** El sistema no es una caja negra. Devuelve un JSON con las razones exactas del veredicto (semáforo Rojo/Amarillo/Verde).
- **Human-in-the-loop:** La IA solo sugiere. El funcionario o el Administrador de Tercero toma la decisión final de revocar o ignorar el correo.

## 🏗️ Stack Tecnológico
- **Backend:** Cloudflare Workers (JavaScript).
- **Base de Datos:** Cloudflare D1 (SQLite Serverless).
- **Frontend:** Astro (Landing Page) + Vanilla JS (Dashboard).
- **API:** Endpoint REST `/api/analyze` listo para integraciones de terceros (ej. WhatsApp).

## ⚙️ Instalación Local
1. Clona el repositorio: `git clone https://github.com/tu-usuario/caza-phish.git`
2. Instala dependencias: `npm install`
3. Inicia el servidor de desarrollo: `npx wrangler dev`
4. Abre `http://localhost:8787` en tu navegador.

## 👥 El Equipo (ALPHA)
- **Piloto / Backend & IA:** [Tu Nombre]
- **Frontend & UX:** [Nombre del compañero de Python]
- **Landing & Astro:** [Nombre del compañero nuevo]
- **Documentación & Pitch:** [Nombre del encargado]