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
    // 1. Obtiene tu lista de puertos desde la colección 'zonasMarea' en Firestore
    const zonasSnapshot = await db.collection('zonasMarea').get();
    const zonas = zonasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 2. Llama a la API de Stormglass para cada zona (hasta 9 para estar dentro del límite gratuito)
    const updatePromises = zonas.slice(0, 9).map(async (zona) => {
      const { id, lat, lng } = zona;
      console.log(`Obteniendo marea para la zona: ${id}`);
      
      // --- INICIO DE LA MODIFICACIÓN ---
      // Define el rango de fechas: desde ahora hasta 7 días en el futuro
      const now = new Date();
      const start = now.toISOString();
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      // --- FIN DE LA MODIFICACIÓN ---

      const response = await axios.get(
        // Añadimos los parámetros 'start' y 'end' a la URL
        `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}&end=${end}`,
        { headers: { 'Authorization': stormglassApiKey } }
      );
      
      const mareasDeLaSemana = response.data.data;
      const docRef = db.collection('mareasDiarias').doc(id);
      
      // 3. Guarda los datos de la marea de toda la semana en la colección 'mareasDiarias'
      await docRef.set({
        mareas: mareasDeLaSemana,
        ultimaActualizacion: new Date()
      });
    });

    // Espera a que todas las actualizaciones terminen
    await Promise.all(updatePromises);

    console.log("Trabajo programado completado exitosamente.");
    res.status(200).send('Actualización de mareas completada exitosamente.');

  } catch (error) {
    console.error("Error en el trabajo programado:", error.response ? error.response.data : error.message);
    res.status(500).send('Ocurrió un error durante la actualización de mareas.');
  }
}
