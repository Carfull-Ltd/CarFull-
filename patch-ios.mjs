import fs from 'node:fs';
import path from 'node:path';

// Release settings for CarFull 1.0 (Build 7).
const projectFiles=['ios/App/Podfile','ios/App/App.xcodeproj/project.pbxproj'];
for(const file of projectFiles){
  if(!fs.existsSync(file)) continue;
  let s=fs.readFileSync(file,'utf8');
  s=s.replace(/platform :ios, ['"]\d+(?:\.\d+)?['"]/g,"platform :ios, '15.0'");
  s=s.replace(/IPHONEOS_DEPLOYMENT_TARGET = \d+(?:\.\d+)?;/g,'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
  s=s.replace(/CURRENT_PROJECT_VERSION = \d+;/g,'CURRENT_PROJECT_VERSION = 7;');
  s=s.replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = 1.0;');
  fs.writeFileSync(file,s);
}

// Replace Capacitor's default/placeholder app icon with the final CarFull icon.
const sourceIcon='app-icon-1024.png';
const appIconDir='ios/App/App/Assets.xcassets/AppIcon.appiconset';
if(!fs.existsSync(sourceIcon)) throw new Error('Missing final CarFull app icon: '+sourceIcon);
if(!fs.existsSync(appIconDir)) throw new Error('Missing iOS AppIcon asset catalogue: '+appIconDir);

for(const name of fs.readdirSync(appIconDir)){
  if(/\.(png|jpg|jpeg)$/i.test(name)) fs.rmSync(path.join(appIconDir,name));
}
const finalIconName='CarFull-AppIcon-1024.png';
fs.copyFileSync(sourceIcon,path.join(appIconDir,finalIconName));
fs.writeFileSync(path.join(appIconDir,'Contents.json'),JSON.stringify({
  images:[{
    filename:finalIconName,
    idiom:'universal',
    platform:'ios',
    size:'1024x1024'
  }],
  info:{author:'xcode',version:1}
},null,2)+'\n');

console.log('CarFull iOS release configured: version 1.0, build 7, iOS 15.0 minimum, final app icon installed.');
