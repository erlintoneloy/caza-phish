📄 SPEC.md — EscudoPhish
1. Problema e Impacto (El Dolor Ciudadano)
Los funcionarios públicos son el eslabón más débil ante ataques de ingeniería social. Con el auge de la IA generativa, los atacantes crean correos de phishing hiperrealistas (como el caso Retool o Arup) que roban credenciales o comprometen infraestructura crítica. El impacto no es solo la pérdida de datos, sino la paralización de servicios públicos.
2. Usuarios y Casos de Uso
Usuario Principal: Funcionarios públicos de cualquier nivel (administrativo, técnico, directivo).
Caso de Uso: Un funcionario recibe un correo sospechoso. Lo copia y lo pega en EscudoPhish. La IA analiza el texto (remitente, asunto y cuerpo), detecta patrones de urgencia, enlaces falsos o suplantación, y le muestra un veredicto explicable en semáforo (Rojo, Amarillo, Verde) con las razones exactas del riesgo.
3. Alcance del MVP (Qué SÍ y Qué NO)
SÍ Hacemos:
Un formulario web para pegar el texto del correo.
Un backend en Cloudflare Worker que procesa el texto.
Integración con Cloudflare Workers AI (Llama 3.1 Fast) para el análisis explicable.
Uso de Regex en JavaScript para detectar URLs sospechosas o dominios extraños (Capa 1).
Una base de datos D1 para guardar el historial de reportes.
NO Hacemos (Stretch Goals): No integramos directamente con servidores de correo (IMAP/Exchange), no analizamos adjuntos pesados ni entrenamos modelos propios.
4. Uso de IA (Modelo y Explicabilidad)
Modelo: @cf/meta/llama-3.1-8b-instruct-fast.
Propósito: El modelo actúa como un analista de ciberseguridad. Recibe el texto del correo y devuelve un JSON estricto con: riesgo (ALTO/MEDIO/BAJO), razones (lista de strings explicando el por qué) y recomendacion (qué debe hacer el humano).
Explicabilidad: La IA no es una caja negra. La interfaz le dice al usuario exactamente por qué el correo es peligroso (ej. "El remitente usa un dominio falso", "El lenguaje es excesivamente urgente").
5. Ética, Sesgos y Privacidad
Privacidad: El MVP no guarda información personal del funcionario. Solo guarda el texto del correo reportado en D1 para auditoría.
Sesgos: El sistema se apoya en reglas heurísticas (Regex) para no depender 100% del criterio probabilístico de la IA.
Uso Ético: La IA se usa para defender, no para atacar.
6. Human-in-the-loop (Decisión Humana)
El sistema nunca bloquea un correo de forma automática. EscudoPhish es una herramienta de apoyo a la decisión. Si la IA marca "Riesgo Alto", el funcionario es quien tiene la última palabra (ignorar, borrar o reportar a su equipo de TI). Esto evita falsos positivos que paralicen la gestión pública.
7. Escalabilidad y Sostenibilidad
Tecnología: Cloudflare Edge permite escalar de 10 a 10,000 funcionarios simultáneos sin caídas de servidor.
Sostenibilidad: El plan gratuito de Cloudflare cubre perfectamente la fase piloto de UNETI. Para producción nacional, el costo operativo es mínimo en comparación con soluciones corporativas licenciadas.
8. Stack y Arquitectura
Frontend: HTML5, CSS3 (Paleta oscura/cian/rojo), Vanilla JS, alojado en Cloudflare Pages.
Backend: Cloudflare Workers (JS).
Base de Datos: Cloudflare D1.
IA: Cloudflare Workers AI.
9. Demo y Enlaces (Se completará al final)
Enlace a la Demo Funcional: [Pendiente de despliegue]
Repositorio GitHub: [Pendiente de subir]
