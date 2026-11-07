import { Bricolage_Grotesque } from "next/font/google";

/**
 * The Convo look shared by onboarding and the app screens: the wrapper
 * gets `convoThemeClass`, and ./convo.css (imported by each layout)
 * scopes the colour tokens to it.
 */
const convoFont = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-onb", display: "swap" });

export const convoThemeClass = `onb ${convoFont.variable}`;
