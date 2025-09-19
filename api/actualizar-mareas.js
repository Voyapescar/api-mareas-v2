const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const axios = require('axios');

// Carga las claves secretas desde las Variables de Entorno de Vercel
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const stormglassApiKey = process.env.STORMGLASS_API_KEY;

// Inicializa la conexión con Firebase (solo si no se ha hecho antes)
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}
const db = getFirestore();

// Esta es la función principal que se ejecutará
module.exports = async (req, res) => {
  console.log("Iniciando trabajo programado: Actualización de mareas...");

  try {
    const zonasSnapshot = await db.collection('zonasMarea').get();
    const zonas = zonasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const updatePromises = zonas.slice(0, 9).map(async (zona) => {
      const { id, lat, lng } = zona;
      console.log(`Obteniendo marea para la zona: ${id}`);
      
      const now = new Date();
      // Pedimos datos para los próximos 7 días para poder calcular el mínimo
      const start = now.toISOString();
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const response = await axios.get(
        `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}&end=${end}`,
        { headers: { 'Authorization': stormglassApiKey } }
      );
      
      const mareasOriginales = response.data.data;

      // --- INICIO: LÓGICA DE CONVERSIÓN ---
      if (mareasOriginales && mareasOriginales.length > 0) {
        // 1. Encontrar la altura más baja de toda la semana.
        const alturaMasBaja = Math.min(...mareasOriginales.map(t => t.height));

        // 2. Recalcular cada altura restando la más baja.
        const mareasConvertidas = mareasOriginales.map(tide => ({
          ...tide,
          height: tide.height - alturaMasBaja // La fórmula mágica
        }));

        const docRef = db.collection('mareasDiarias').doc(id);
      
        // 3. Guardar los datos ya convertidos en Firestore.
        await docRef.set({
          mareas: mareasConvertidas,
          ultimaActualizacion: new Date()
        });
      }
      // --- FIN: LÓGICA DE CONVERSIÓN ---
    });

    await Promise.all(updatePromises);

    console.log("Trabajo programado completado exitosamente.");
    res.status(200).send('Actualización de mareas completada exitosamente.');

  } catch (error) {
    console.error("Error en el trabajo programado:", error.response ? error.response.data : error.message);
    res.status(500).send('Ocurrió un error durante la actualización de mareas.');
  }
}

