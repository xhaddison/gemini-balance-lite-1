
import { exec } from 'child_process';
import { readFile, writeFile } from 'fs/promises';

const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${command}`);
        console.error(stderr);
        return reject(error);
      }
      resolve(stdout);
    });
  });
};

const updateProjectFile = async (filePath, newUrl) => {
  try {
    let content = await readFile(filePath, 'utf-8');
    const urlRegex = /(https?:\/\/[^\s]+-gemini-balance-lite[^\s]*)/g;
    if (!urlRegex.test(content)) {
        console.log(`No production URL found in ${filePath} to update. Appending new URL.`);
        content += `\nProduction URL: ${newUrl}\n`;
    } else {
        content = content.replace(urlRegex, newUrl);
    }
    await writeFile(filePath, content, 'utf-8');
    console.log(`Successfully updated ${filePath} with new URL: ${newUrl}`);
  } catch (error) {
    console.error(`Failed to update ${filePath}:`, error);
    throw error;
  }
};

const deployAndVerify = async () => {
  try {
    console.log('Starting deployment...');
    const deployOutput = await executeCommand('vercel --prod');
    console.log('Deployment command executed.');
    console.log(deployOutput);

    const urlMatch = deployOutput.match(/https?:\/\/[^\s]+\.vercel\.app/);
    if (!urlMatch) {
      throw new Error('Failed to extract production URL from deployment output.');
    }
    const newProdUrl = urlMatch[0];
    console.log(`Extracted new production URL: ${newProdUrl}`);

    console.log('Performing health check...');
    const response = await fetch(newProdUrl, { method: 'GET' }).catch(e => {
        console.error('Health check request failed:', e.message);
        throw new Error(`Health check failed: ${e.message}`);
    });

    console.log(`Health check response status: ${response.status}`);
    if (response.status !== 401) {
      throw new Error(`Health check failed. Expected status 401, but got ${response.status}.`);
    }
    console.log('Health check successful (401 Unauthorized).');

    console.log('Updating project files...');
    await updateProjectFile('/Users/addison/repository/gemini-balance-lite/Project_Status.md', newProdUrl);
    await updateProjectFile('/Users/addison/repository/gemini-balance-lite/Project_Manifest.md', newProdUrl);
    console.log('Project files updated successfully.');

    console.log('Deployment and verification process completed successfully.');

  } catch (error) {
    console.error('An error occurred during the deploy and verify process:', error.message);
    process.exit(1);
  }
};

deployAndVerify();
