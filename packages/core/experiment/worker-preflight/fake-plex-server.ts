// The Plex plugin's own test fake, run as a child process so its memory is not the host's.
import { fakeToken, startFakePlex } from "../../../plugins/plex/test/fake-plex.ts";

const fake = startFakePlex();
console.log(JSON.stringify({ url: fake.url, token: fakeToken }));
