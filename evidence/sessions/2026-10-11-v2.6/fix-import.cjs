const fs=require('fs');const p='apps/web/src/components/widgets/RedGreenGateBadge.tsx';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace("import { localizedValue } from '../../i18n';\n",''));
