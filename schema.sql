DROP TABLE IF EXISTS reportes;
DROP TABLE IF EXISTS terceros;

CREATE TABLE terceros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT 1
);

CREATE TABLE reportes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tercero_id INTEGER,
    texto_original TEXT NOT NULL,
    veredicto_ia TEXT NOT NULL,
    estado TEXT DEFAULT 'ACTIVO',
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tercero_id) REFERENCES terceros(id)
);

INSERT INTO terceros (nombre, api_key) VALUES ('UNETI Demo', 'alpha-secret-key-2026');

CREATE TABLE IF NOT EXISTS administradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'ADMINISTRADOR',
    activo INTEGER DEFAULT 1,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO administradores (nombre, usuario, password, rol, activo)
VALUES ('Administrador General', 'admin@cazaphish.com', 'admin123456', 'ADMINISTRADOR', 1);