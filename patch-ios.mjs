import fs from 'node:fs';
const files=['ios/App/Podfile','ios/App/App.xcodeproj/project.pbxproj'];
for(const file of files){
  if(!fs.existsSync(file)) continue;
  let s=fs.readFileSync(file,'utf8');
  s=s.replace(/platform :ios, ['\"]\d+(?:\.\d+)?['\"]/g,"platform :ios, '15.0'");
  s=s.replace(/IPHONEOS_DEPLOYMENT_TARGET = \d+(?:\.\d+)?;/g,'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
  s=s.replace(/CURRENT_PROJECT_VERSION = \d+;/g,'CURRENT_PROJECT_VERSION = 2;');
  s=s.replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = 1.0;');
  fs.writeFileSync(file,s);
}
console.log('CarFull iOS minimum deployment target set to iOS 15.0');
