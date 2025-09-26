
const fs = require('fs-extra');
const path = require('path');

const gitignorePath = path.join(__dirname, '.gitignore');
const rulesToAdd = [
  '# Environment variables',
  '.env*.local',
  '.env',
  '',
  '# Node dependencies',
  'node_modules/',
  '',
  '# Build directory',
  '.next/',
  'out/',
  '',
  '# Log files',
  '*.log',
  '',
  '# Temporary files',
  '*.tmp',
  '*.swp'
];

try {
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  const lines = content.split('\\n');
  let updated = false;

  rulesToAdd.forEach(rule => {
    if (!lines.includes(rule.trim())) {
      content += '\\n' + rule;
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(gitignorePath, content, 'utf8');
    console.log('.gitignore has been successfully created or updated.');
  } else {
    console.log('.gitignore already contains all necessary rules. No changes made.');
  }

} catch (err) {
  console.error('Error updating .gitignore:', err);
}
