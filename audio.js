 // --- Core Audio Utility Functions ---
        // Converts base64 encoded string to ArrayBuffer
        function base64ToArrayBuffer(base64) {
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        }

        // Converts PCM audio data to WAV format Blob
        function pcmToWav(pcm16, sampleRate) {
            const buffer = new ArrayBuffer(44 + pcm16.length * 2);
            const view = new DataView(buffer);
            let offset = 0;

            function writeString(s) {
                for (let i = 0; i < s.length; i++) {
                    view.setUint8(offset++, s.charCodeAt(i));
                }
            }

            function writeUint32(i) {
                view.setUint32(offset, i, true);
                offset += 4;
            }

            function writeUint16(i) {
                view.setUint16(offset, i, true);
                offset += 2;
            }

            // RIFF chunk
            writeString('RIFF');
            writeUint32(36 + pcm16.length * 2); // Chunk size
            writeString('WAVE');

            // FMT chunk
            writeString('fmt ');
            writeUint32(16); // Chunk size (16 for PCM)
            writeUint16(1);  // Audio format (1 for PCM)
            writeUint16(1);  // Number of channels (Mono)
            writeUint32(sampleRate);
            writeUint32(sampleRate * 2); // Byte rate (SampleRate * Channels * BitsPerSample/8)
            writeUint16(2);  // Block align (Channels * BitsPerSample/8)
            writeUint16(16); // Bits per sample

            // DATA chunk
            writeString('data');
            writeUint32(pcm16.length * 2); // Chunk size

            // Write PCM data
            for (let i = 0; i < pcm16.length; i++) {
                view.setInt16(offset, pcm16[i], true);
                offset += 2;
            }

            return new Blob([buffer], { type: 'audio/wav' });
        }

        // --- API Calls and Logic ---

        const generateButton = document.getElementById('generate-button');
        const buttonText = document.getElementById('button-text');
        const loadingIndicator = document.getElementById('loading-indicator');
        const scriptOutput = document.getElementById('script-output');
        const audioPlayer = document.getElementById('audio-player');
        const messageBox = document.getElementById('message-box');

        let isGenerating = false;

        function showLoading(isLoading, text) {
            isGenerating = isLoading;
            generateButton.disabled = isLoading;
            buttonText.textContent = text;
            loadingIndicator.classList.toggle('hidden', !isLoading);
            generateButton.classList.toggle('opacity-50', isLoading);
        }

        function showMessage(text, isError = false) {
            messageBox.textContent = text;
            messageBox.classList.toggle('bg-red-100', isError);
            messageBox.classList.toggle('text-red-700', isError);
            messageBox.classList.toggle('bg-green-100', !isError);
            messageBox.classList.toggle('text-green-700', !isError);
            messageBox.classList.remove('hidden');
        }

        function hideMessage() {
            messageBox.classList.add('hidden');
        }

        /**
         * Retries a fetch request with exponential backoff.
         */
        async function fetchWithRetry(url, options, retries = 5) {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(url, options);
                    if (response.status !== 429) { // Not a rate limit error
                        return response;
                    }
                    // Rate limit error (429), wait and retry
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
                } catch (error) {
                    // For network errors, wait and retry
                    if (i === retries - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
                }
            }
            throw new Error('Maximum retries exceeded.');
        }

        /**
         * 1. Generates a conversation script using Gemini (Text only).
         */
        async function generateScript(speaker1Name, speaker2Name, language, length) {
            // APPLYING THE FIX: Strict instruction to only output dialogue and remove scenarios
            const userQuery = `Write a ${length}, funny conversation script in ${language} between two people named ${speaker1Name} and ${speaker2Name}. Output ONLY the dialogue. Do NOT include any descriptions, scene settings, or character actions. The script must clearly follow this format:\n${speaker1Name}: [Line 1]\n${speaker2Name}: [Line 2]... and so on.`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: {
                    parts: [{ text: "You are a professional comedy writer. Your goal is to write a brief, extremely funny and culturally relevant conversation script based on the specified length and language. You MUST only output the conversation text, without any narrative or scene descriptions." }]
                },
            };

            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

            const response = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!text) {
                throw new Error("Failed to generate script text. The API response was empty or malformed.");
            }
            return text.trim();
        }

        /**
         * 2. Generates multi-speaker audio from the script using Gemini (TTS).
         */
        async function generateAudio(script, speaker1Name, speaker1Voice, speaker2Name, speaker2Voice) {
            const ttsPrompt = `TTS the following conversation between ${speaker1Name} and ${speaker2Name}:\n${script}`;
            
            const payload = {
                contents: [{ parts: [{ text: ttsPrompt }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        multiSpeakerVoiceConfig: {
                            speakerVoiceConfigs: [
                                { speaker: speaker1Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1Voice } } },
                                { speaker: speaker2Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2Voice } } }
                            ]
                        }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };
            
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

            const response = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            
            if (!part || !part.inlineData || !part.inlineData.data || !part.inlineData.mimeType) {
                throw new Error("Failed to generate audio data. Check if speakers/script were correctly formatted.");
            }
            
            const audioData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType;

            // Extract sample rate from mimeType (e.g., audio/L16;rate=24000)
            const rateMatch = mimeType.match(/rate=(\d+)/);
            const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000; // Default to 24000 if not found

            return { audioData, sampleRate };
        }

        async function generateAndPlay() {
            if (isGenerating) return;

            hideMessage();
            scriptOutput.textContent = 'Generating funny script...';
            audioPlayer.classList.add('hidden');
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');

            const speaker1Name = document.getElementById('speaker1-name').value.trim() || 'Ramesh';
            const speaker1Voice = document.getElementById('speaker1-voice').value;
            const speaker2Name = document.getElementById('speaker2-name').value.trim() || 'Sita';
            const speaker2Voice = document.getElementById('speaker2-voice').value;
            const scriptLanguage = document.getElementById('script-language').value;
            const scriptLength = document.getElementById('script-length').value.trim() || 'short, funny conversation';
            
            try {
                // 1. Generate Script
                showLoading(true, 'Generating Script...');
                const script = await generateScript(speaker1Name, speaker2Name, scriptLanguage, scriptLength);
                scriptOutput.textContent = script;

                // 2. Generate Audio
                showLoading(true, 'Synthesizing Multi-Speaker Audio...');
                const { audioData, sampleRate } = await generateAudio(script, speaker1Name, speaker1Voice, speaker2Name, speaker2Voice);
                
                // 3. Process and Play Audio
                const pcmData = base64ToArrayBuffer(audioData);
                // API returns signed PCM16 audio data.
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                
                const audioUrl = URL.createObjectURL(wavBlob);
                audioPlayer.src = audioUrl;
                audioPlayer.classList.remove('hidden');
                audioPlayer.play();
                
                showMessage('Success! Audio generated and playing.', false);

            } catch (error) {
                console.error("Generation error:", error);
                showMessage(`Generation failed: ${error.message}. Please check the console for details.`, true);
                scriptOutput.textContent = 'Error during generation.';
            } finally {
                showLoading(false, 'Generate & Play Audio');
            }
        }

        // Attach event listener to the button
        generateButton.addEventListener('click', generateAndPlay);
