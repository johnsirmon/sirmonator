import {defineConfig} from 'vite';
import {thirdPartyNotices} from './scripts/third-party-notices.mjs';
export default defineConfig({base:'./',plugins:[thirdPartyNotices()],worker:{format:'es'},server:{host:'127.0.0.1'}});
