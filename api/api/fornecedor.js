const axios = require("axios");
const fs = require("fs");
const path = require("path");

require(path.join(__dirname, "../../src/config/env"));

const API_URL = process.env.FORNECEDOR_BRASIL_API_URL || "https://fornecedorbrasil.com/api/v2";
const API_KEY = (process.env.FORNECEDOR_BRASIL_API_KEY || "").trim();

if (!API_KEY) {
    console.error("FORNECEDOR_BRASIL_API_KEY não definida no .env");
    process.exit(1);
}

async function api(payload) {
    try {
        const response = await axios.post(
            API_URL,
            new URLSearchParams({
                key: API_KEY,
                ...payload
            }),
            {
                timeout: 30000,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        return response.data;
    } catch (err) {
        return {
            error: true,
            message: err.response?.data || err.message
        };
    }
}

async function main() {

    const exportData = {
        exportedAt: new Date().toISOString(),
        provider: "FornecedorBrasil",
        balance: null,
        services: [],
        categories: {},
        statistics: {}
    };

    console.log("Obtendo saldo.");

    exportData.balance = await api({
        action: "balance"
    });

    console.log("Obtendo todos os serviços.");

    exportData.services = await api({
        action: "services"
    });

    if (!Array.isArray(exportData.services)) {
        console.log("Erro ao obter serviços:");
        console.log(exportData.services);
        return;
    }

    console.log(`Serviços encontrados: ${exportData.services.length}`);

    for (const service of exportData.services) {

        const category = service.category || "Sem categoria";

        if (!exportData.categories[category]) {
            exportData.categories[category] = {
                total: 0,
                services: []
            };
        }

        exportData.categories[category].total++;

        exportData.categories[category].services.push({
            id: service.service,
            name: service.name,
            type: service.type,
            rate: service.rate,
            min: service.min,
            max: service.max,
            refill: service.refill,
            cancel: service.cancel,
            dripfeed: service.dripfeed
        });
    }

    const rates = exportData.services
        .map(x => Number(x.rate))
        .filter(x => !isNaN(x));

    exportData.statistics = {
        totalServices: exportData.services.length,
        totalCategories: Object.keys(exportData.categories).length,
        cheapestRate: Math.min(...rates),
        highestRate: Math.max(...rates)
    };

    fs.mkdirSync("./export", {
        recursive: true
    });

    fs.writeFileSync(
        "./export/all-services.json",
        JSON.stringify(exportData.services, null, 2)
    );

    fs.writeFileSync(
        "./export/categories.json",
        JSON.stringify(exportData.categories, null, 2)
    );

    fs.writeFileSync(
        "./export/full-export.json",
        JSON.stringify(exportData, null, 2)
    );

    const refillCount = exportData.services.filter(x => x.refill).length;
    const cancelCount = exportData.services.filter(x => x.cancel).length;
    const dripfeedCount = exportData.services.filter(x => x.dripfeed).length;

    const types = {};

    for (const service of exportData.services) {
        const type = service.type || "Desconhecido";
        types[type] = (types[type] || 0) + 1;
    }
    console.log("RELATÓRIO API");

    console.log(`💰 Saldo: ${exportData.balance.balance} ${exportData.balance.currency}`);
    console.log(`📦 Total de serviços: ${exportData.statistics.totalServices}`);
    console.log(`📂 Total de categorias: ${exportData.statistics.totalCategories}`);
    console.log(`📉 Menor preço: ${exportData.statistics.cheapestRate}`);
    console.log(`📈 Maior preço: ${exportData.statistics.highestRate}`);

    console.log("");
    console.log(`♻️ Serviços com refill: ${refillCount}`);
    console.log(`❌ Serviços canceláveis: ${cancelCount}`);
    console.log(`🔄 Serviços com dripfeed: ${dripfeedCount}`);

    console.log("\nTOP 20 CATEGORIAS\n");

    Object.entries(exportData.categories)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 20)
        .forEach(([name, data], index) => {
            console.log(
                `${index + 1}. ${name} (${data.total} serviços)`
            );
        });

    console.log("\nTIPOS DE SERVIÇO\n");

    Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`${type}: ${count}`);
        });

    console.log("\nESTATÍSTICAS\n");

    const avgPrice =
        rates.reduce((a, b) => a + b, 0) / rates.length;

    console.log(`Preço médio: ${avgPrice.toFixed(4)}`);
    console.log(`Serviços com preço acima da média: ${
        rates.filter(x => x > avgPrice).length
    }`);
    console.log(`Serviços com preço abaixo da média: ${
        rates.filter(x => x < avgPrice).length
    }`);

    console.log("\n========== ARQUIVOS GERADOS ==========\n");

    console.log("./export/all-services.json");
    console.log("./export/categories.json");
    console.log("./export/full-export.json");

    console.log("\nExportação concluída com sucesso.");
}

main();