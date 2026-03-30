import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { RpaService } from "../rpa.service";
import { PrismaService } from "../../core/prisma.service";

async function run() {
	console.log("Starting Server Test Script...");
	const app = await NestFactory.createApplicationContext(AppModule);
	const prisma = app.get(PrismaService);
	const rpa = app.get(RpaService);

	try {
		// We'll find a patient that has insurance data.
		const patients = await prisma.patient.findMany({
			where: { rawData: { some: { dataType: "INSURANCE" } } },
			take: 2,
			orderBy: { id: "desc" }
		});

		if (patients.length === 0) {
			console.log("No patients with insurance data found to test.");
			await app.close();
			process.exit(1);
		}

		console.log(`\n======================================================`);
		console.log(`--- Test 1: Using Patient ID: ${patients[0].id} (${patients[0].name})`);
		console.log(`======================================================`);
		const result1 = await rpa.markPatientAsSeen(patients[0].id);
		console.log("\n-> Result 1 Output:");
		console.log(JSON.stringify(result1, null, 2));

		if (patients.length > 1) {
			console.log(`\n======================================================`);
			console.log(`--- Test 2: Using Patient ID: ${patients[1].id} (${patients[1].name})`);
			console.log(`======================================================`);
			const result2 = await rpa.markPatientAsSeen(patients[1].id);
			console.log("\n-> Result 2 Output:");
			console.log(JSON.stringify(result2, null, 2));
		}
		
	} catch (err) {
		console.error("Test failed with error:", err);
	} finally {
		await app.close();
		process.exit(0);
	}
}

run();
