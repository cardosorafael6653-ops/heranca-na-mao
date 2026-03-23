import express from "express";
import { createServer as createViteServer } from "vite";
import { validarCodigo } from "./validarCodigo";

const app = express();
const PORT = 3000;

app.use(express.json());

// API Validation Route
app.post("/api/validate", (req, res) => {
  try {
    const { code } = req.body;

    if (typeof code !== 'string') {
      return res.json({ valid: false, success: false, message: "Código inválido" });
    }

    const result = validarCodigo(code);

    if (result.valido) {
      return res.json({ 
        valid: true,
        success: true,
        message: "Código validado! Seu relatório está sendo preparado."
      });
    } else {
      return res.json({ 
        valid: false,
        success: false,
        message: result.motivo === "codigo ja utilizado" ? "Este código já foi utilizado." : "Código inválido ou formato incorreto."
      });
    }
  } catch (error) {
    console.error("Validation error:", error);
    return res.status(500).json({ valid: false, success: false, error: "Internal server error" });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
