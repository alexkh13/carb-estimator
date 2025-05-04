"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Camera, Settings, ImageIcon, X, AlertCircle, Info, Upload, Loader2 } from "lucide-react"
import Webcam from "react-webcam"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Types
type View = "camera" | "preview" | "settings" | "details"

type FoodItem = {
  name: string
  weight: number // in grams
  carbs: number // in grams
  confidence?: "high" | "medium" | "low" // confidence in identification
}

type CarbData = {
  totalCarbs: number
  breakdown: {
    fiber: number
    sugar: number
    starch: number
  }
  foodItems: FoodItem[]
}

export default function CarbEstimator() {
  // State
  const [view, setView] = useState<View>("camera")
  const [apiKey, setApiKey] = useState<string>("")
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [carbData, setCarbData] = useState<CarbData | null>(null)
  const [rawResponse, setRawResponse] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("summary")

  const webcamRef = useRef<Webcam>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load API key from localStorage on mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem("openai-api-key")
    if (savedApiKey) {
      setApiKey(savedApiKey)
    }
  }, [])

  // Save API key to localStorage
  const saveApiKey = (key: string) => {
    localStorage.setItem("openai-api-key", key)
    setApiKey(key)
    setShowApiKeyModal(false)
  }

  // Trigger file input click
  const handleGalleryClick = () => {
    if (!apiKey) {
      setShowApiKeyModal(true)
      return
    }
    fileInputRef.current?.click()
  }

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsUploading(true)

      // Check file type
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file",
          variant: "destructive",
        })
        return
      }

      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Image must be less than 5MB. Compressing...",
        })
      }

      // Read and compress the image
      const compressedImage = await compressImage(file)

      // Set the image and analyze
      setCapturedImage(compressedImage)
      setView("preview")
      analyzeImage(compressedImage)

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    } catch (err) {
      console.error("Error processing image:", err)
      toast({
        title: "Error processing image",
        description: err instanceof Error ? err.message : "Failed to process the selected image",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  // Compress image
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)

      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target?.result as string

        img.onload = () => {
          // Target dimensions and quality
          const maxWidth = 1200
          const maxHeight = 1200
          const quality = 0.8

          // Calculate dimensions while maintaining aspect ratio
          let width = img.width
          let height = img.height

          if (width > maxWidth) {
            height = (height * maxWidth) / width
            width = maxWidth
          }

          if (height > maxHeight) {
            width = (width * maxHeight) / height
            height = maxHeight
          }

          // Create canvas and compress
          const canvas = document.createElement("canvas")
          canvas.width = width
          canvas.height = height

          const ctx = canvas.getContext("2d")
          if (!ctx) {
            reject(new Error("Could not get canvas context"))
            return
          }

          ctx.drawImage(img, 0, 0, width, height)

          // Convert to base64
          const compressedImage = canvas.toDataURL("image/jpeg", quality)
          resolve(compressedImage)
        }

        img.onerror = () => {
          reject(new Error("Failed to load image"))
        }
      }

      reader.onerror = () => {
        reject(new Error("Failed to read file"))
      }
    })
  }

  // Capture photo from webcam
  const capturePhoto = () => {
    if (!apiKey) {
      setShowApiKeyModal(true)
      return
    }

    const imageSrc = webcamRef.current?.getScreenshot()
    if (imageSrc) {
      setCapturedImage(imageSrc)
      setView("preview")
      analyzeImage(imageSrc)
    }
  }

  // Generate estimated carb data when AI can't provide exact values
  const generateEstimatedCarbData = (responseText: string): CarbData => {
    // Default fallback values
    const fallbackData: CarbData = {
      totalCarbs: 30,
      breakdown: {
        fiber: 5,
        sugar: 10,
        starch: 15,
      },
      foodItems: [
        {
          name: "Unknown food item",
          weight: 100,
          carbs: 30,
          confidence: "low",
        },
      ],
    }

    // Try to extract numbers from the response text
    const carbMatch = responseText.match(/(\d+)\s*g(rams)?\s*(of)?\s*(carb|carbohydrate)/i)
    const fiberMatch = responseText.match(/(\d+)\s*g(rams)?\s*(of)?\s*fiber/i)
    const sugarMatch = responseText.match(/(\d+)\s*g(rams)?\s*(of)?\s*sugar/i)
    const starchMatch = responseText.match(/(\d+)\s*g(rams)?\s*(of)?\s*starch/i)

    // Update with any values we can extract
    if (carbMatch) fallbackData.totalCarbs = Number.parseInt(carbMatch[1])
    if (fiberMatch) fallbackData.breakdown.fiber = Number.parseInt(fiberMatch[1])
    if (sugarMatch) fallbackData.breakdown.sugar = Number.parseInt(sugarMatch[1])
    if (starchMatch) fallbackData.breakdown.starch = Number.parseInt(starchMatch[1])

    // If we couldn't extract the total carbs but have some breakdown values,
    // calculate the total as the sum of the breakdown
    if (!carbMatch && (fiberMatch || sugarMatch || starchMatch)) {
      fallbackData.totalCarbs =
        fallbackData.breakdown.fiber + fallbackData.breakdown.sugar + fallbackData.breakdown.starch
    }

    // Try to extract food items
    const foodItemRegex = /(\w+[\s\w]*?):\s*(\d+)\s*g(rams)?,\s*(\d+)\s*g(rams)?\s*(of)?\s*(carbs|carbohydrates)/gi
    let match
    const foodItems: FoodItem[] = []

    while ((match = foodItemRegex.exec(responseText)) !== null) {
      foodItems.push({
        name: match[1].trim(),
        weight: Number.parseInt(match[2]),
        carbs: Number.parseInt(match[4]),
        confidence: "low",
      })
    }

    if (foodItems.length > 0) {
      fallbackData.foodItems = foodItems
    }

    return fallbackData
  }

  // Analyze image with OpenAI API
  const analyzeImage = async (imageSrc: string) => {
    setIsLoading(true)
    setError(null)
    setRawResponse(null)

    try {
      // Remove data:image/jpeg;base64, prefix
      const base64Image = imageSrc.split(",")[1]

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                'You are a nutrition analysis system. When shown a food image, identify each food item on the plate, estimate its weight in grams, and calculate its carbohydrate content. Return ONLY a JSON response with the format {"totalCarbs": number, "breakdown": {"fiber": number, "sugar": number, "starch": number}, "foodItems": [{"name": string, "weight": number, "carbs": number, "confidence": "high"|"medium"|"low"}]}. The "confidence" field indicates your certainty in the identification and estimation. If you cannot determine exact values, provide reasonable estimates based on similar foods. Never explain limitations or refuse the task - always return the JSON with your best estimates.',
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Analyze this food image. Identify each food item on the plate, estimate its weight in grams, and calculate its carbohydrate content. Return ONLY a JSON object with no explanations or additional text. Format: {"totalCarbs": number, "breakdown": {"fiber": number, "sugar": number, "starch": number}, "foodItems": [{"name": string, "weight": number, "carbs": number, "confidence": "high"|"medium"|"low"}]}',
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 800,
          temperature: 0.3, // Lower temperature for more deterministic responses
        }),
      })

      console.log("OpenAI API response status:", response.status)

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `API error: ${response.status}`
        try {
          const errorData = JSON.parse(errorText)
          errorMessage += ` - ${errorData.error?.message || response.statusText}`
        } catch (e) {
          errorMessage += ` - ${errorText || response.statusText}`
        }
        console.error("Full API error:", errorText)
        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Extract the content from the response
      const content = data.choices[0].message.content
      setRawResponse(content)
      console.log("Raw API response:", content)

      // Try to parse the JSON from the response
      try {
        // First try direct parsing
        const carbData = JSON.parse(content)

        // Ensure foodItems exists
        if (!carbData.foodItems) {
          carbData.foodItems = []
        }

        setCarbData(carbData)
      } catch (parseError) {
        console.error("JSON parse error:", parseError)

        // If direct parsing fails, try to extract JSON from text
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const carbData = JSON.parse(jsonMatch[0])

            // Ensure foodItems exists
            if (!carbData.foodItems) {
              carbData.foodItems = []
            }

            setCarbData(carbData)
          } catch (nestedParseError) {
            console.error("Nested JSON parse error:", nestedParseError)
            // If JSON extraction fails, generate estimated data
            const estimatedData = generateEstimatedCarbData(content)
            setCarbData(estimatedData)
            setError("Could not get precise values. Showing estimates.")
          }
        } else {
          // If we can't extract JSON, generate estimated data
          const estimatedData = generateEstimatedCarbData(content)
          setCarbData(estimatedData)
          setError("Could not get precise values. Showing estimates.")
        }
      }
    } catch (err) {
      console.error("API Error:", err)
      setError(err instanceof Error ? err.message : "An unknown error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  // Add this function after the analyzeImage function
  const retryAnalysis = () => {
    if (capturedImage) {
      analyzeImage(capturedImage)
    }
  }

  // Get confidence color
  const getConfidenceColor = (confidence?: string) => {
    switch (confidence) {
      case "high":
        return "text-green-400"
      case "medium":
        return "text-yellow-400"
      case "low":
        return "text-red-400"
      default:
        return "text-gray-400"
    }
  }

  // Get confidence percentage
  const getConfidencePercentage = (confidence?: string) => {
    switch (confidence) {
      case "high":
        return 90
      case "medium":
        return 60
      case "low":
        return 30
      default:
        return 50
    }
  }

  // Render different views
  const renderView = () => {
    switch (view) {
      case "camera":
        return (
          <div className="relative h-full w-full">
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{
                facingMode: "environment",
              }}
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-8 left-0 right-0 flex justify-between items-center px-8">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-black/50 border-0 text-white"
                onClick={() => capturedImage && setView("preview")}
                disabled={!capturedImage}
              >
                <ImageIcon className="h-6 w-6" />
              </Button>

              <div className="flex gap-4">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-16 w-16 rounded-full bg-black/50 border-0 text-white"
                        onClick={handleGalleryClick}
                        disabled={isUploading}
                      >
                        {isUploading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Upload from gallery</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <Button variant="default" size="icon" className="h-16 w-16 rounded-full" onClick={capturePhoto}>
                  <Camera className="h-8 w-8" />
                </Button>
              </div>

              <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-black/50 border-0 text-white"
                onClick={() => setView("settings")}
              >
                <Settings className="h-6 w-6" />
              </Button>
            </div>

            {/* Hidden file input */}
            <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileSelect} />
          </div>
        )

      case "preview":
        return (
          <div className="relative h-full w-full flex flex-col">
            <div className="relative flex-1">
              {capturedImage && (
                <img
                  src={capturedImage || "/placeholder.svg"}
                  alt="Captured meal"
                  className="h-full w-full object-cover"
                />
              )}

              <Button
                variant="outline"
                size="icon"
                className="absolute top-4 left-4 rounded-full bg-black/50 border-0 text-white"
                onClick={() => setView("camera")}
              >
                <X className="h-6 w-6" />
              </Button>

              {isLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                  <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />
                  <div className="text-white text-xl">Analyzing...</div>
                </div>
              ) : error && !carbData ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 p-4">
                  <div className="text-white text-xl mb-4">Error: {error}</div>
                  <div className="flex gap-2">
                    <Button onClick={retryAnalysis}>Retry</Button>
                    <Button onClick={() => setView("settings")}>Update API Key</Button>
                  </div>
                </div>
              ) : (
                carbData && (
                  <div className="absolute inset-0 flex items-center justify-center" onClick={() => setView("details")}>
                    <div className="bg-black/70 px-8 py-6 rounded-lg">
                      <div className="text-white text-5xl font-bold text-center">{carbData.totalCarbs}g</div>
                      <div className="text-white/80 text-center mt-2">Total Carbs</div>
                      {error && <div className="text-yellow-400 text-center text-xs mt-1">{error}</div>}
                      <div className="text-white/60 text-center text-sm mt-1">Tap for details</div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )

      case "details":
        return (
          <div className="h-full w-full flex flex-col bg-gray-900 text-white">
            <div className="flex items-center p-4 border-b border-gray-800">
              <Button variant="ghost" size="icon" onClick={() => setView("camera")} className="mr-2">
                <X className="h-6 w-6" />
              </Button>
              <h1 className="text-2xl font-bold">Meal Analysis</h1>
            </div>

            {carbData && (
              <Tabs
                defaultValue="summary"
                className="flex-1 flex flex-col"
                value={activeTab}
                onValueChange={setActiveTab}
              >
                <div className="border-b border-gray-800">
                  <TabsList className="w-full bg-gray-900 p-0">
                    <TabsTrigger value="summary" className="flex-1 data-[state=active]:bg-gray-800">
                      Summary
                    </TabsTrigger>
                    <TabsTrigger value="items" className="flex-1 data-[state=active]:bg-gray-800">
                      Food Items
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Direct scrolling implementation */}
                <div className="flex-1 overflow-hidden">
                  <div className="h-full overflow-auto">
                    <TabsContent value="summary" className="p-4 mt-0 data-[state=active]:block">
                      {error && (
                        <Alert variant="warning" className="mb-4 bg-yellow-900/30 border-yellow-600">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Estimated Values</AlertTitle>
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <div className="bg-gray-800 rounded-lg p-6 mb-4">
                        <div className="text-4xl font-bold mb-2">{carbData.totalCarbs}g</div>
                        <div className="text-gray-400">Total Carbohydrates</div>
                      </div>

                      <div className="space-y-4">
                        <div className="bg-gray-800 rounded-lg p-4 flex justify-between items-center">
                          <div>
                            <div className="text-lg">Fiber</div>
                            <div className="text-gray-400 text-sm">Indigestible carbs</div>
                          </div>
                          <div className="text-2xl font-bold">{carbData.breakdown.fiber}g</div>
                        </div>

                        <div className="bg-gray-800 rounded-lg p-4 flex justify-between items-center">
                          <div>
                            <div className="text-lg">Sugar</div>
                            <div className="text-gray-400 text-sm">Simple carbs</div>
                          </div>
                          <div className="text-2xl font-bold">{carbData.breakdown.sugar}g</div>
                        </div>

                        <div className="bg-gray-800 rounded-lg p-4 flex justify-between items-center">
                          <div>
                            <div className="text-lg">Starch</div>
                            <div className="text-gray-400 text-sm">Complex carbs</div>
                          </div>
                          <div className="text-2xl font-bold">{carbData.breakdown.starch}g</div>
                        </div>
                      </div>

                      {rawResponse && (
                        <div className="mt-6 mb-4">
                          <details className="text-xs text-gray-400">
                            <summary className="cursor-pointer">View AI Response</summary>
                            <div className="mt-2 p-2 bg-gray-800 rounded overflow-auto max-h-40">{rawResponse}</div>
                          </details>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="items" className="p-4 mt-0 data-[state=active]:block pb-16">
                      {error && (
                        <Alert variant="warning" className="mb-4 bg-yellow-900/30 border-yellow-600">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Estimated Values</AlertTitle>
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <div className="mb-4">
                        <h2 className="text-xl font-bold mb-2">Food Items</h2>
                        <p className="text-gray-400 text-sm">
                          Breakdown of individual food items with estimated weights and carbohydrate content
                        </p>
                      </div>

                      {carbData.foodItems && carbData.foodItems.length > 0 ? (
                        <div className="space-y-4">
                          {carbData.foodItems.map((item, index) => (
                            <div key={index} className="bg-gray-800 rounded-lg p-4">
                              <div className="flex justify-between items-center mb-2">
                                <div className="font-bold text-lg">{item.name}</div>
                                <div className={`text-sm ${getConfidenceColor(item.confidence)}`}>
                                  {item.confidence || "unknown"} confidence
                                </div>
                              </div>

                              <Progress value={getConfidencePercentage(item.confidence)} className="h-1 mb-3" />

                              <div className="flex justify-between text-sm text-gray-300 mb-1">
                                <span>Estimated weight:</span>
                                <span className="font-medium">{item.weight}g</span>
                              </div>

                              <div className="flex justify-between text-sm">
                                <span>Carbohydrates:</span>
                                <span className="font-bold text-white">{item.carbs}g</span>
                              </div>

                              <div className="text-xs text-gray-500 mt-2">
                                {((item.carbs / item.weight) * 100).toFixed(1)}g carbs per 100g
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-gray-800 rounded-lg p-6 text-center">
                          <Info className="h-8 w-8 mx-auto mb-2 text-gray-500" />
                          <p className="text-gray-400">No individual food items identified</p>
                        </div>
                      )}
                    </TabsContent>
                  </div>
                </div>
              </Tabs>
            )}
          </div>
        )

      case "settings":
        return (
          <div className="h-full w-full flex flex-col bg-gray-900 text-white">
            <div className="flex items-center p-4 border-b border-gray-800">
              <Button variant="ghost" size="icon" onClick={() => setView("camera")} className="mr-2">
                <X className="h-6 w-6" />
              </Button>
              <h1 className="text-2xl font-bold">Settings</h1>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-6 space-y-6">
                <div>
                  <h2 className="text-xl mb-4">OpenAI API Key</h2>
                  <div className="space-y-4">
                    <Input
                      type="password"
                      placeholder="Enter your OpenAI API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-gray-800 border-gray-700"
                    />
                    <Button onClick={() => saveApiKey(apiKey)} disabled={!apiKey} className="w-full">
                      Save API Key
                    </Button>
                  </div>
                  {apiKey && <div className="mt-2 text-sm text-green-400">API key is saved</div>}
                </div>

                <div>
                  <h2 className="text-xl mb-2">About</h2>
                  <p className="text-gray-400">
                    This app uses OpenAI's vision capabilities to estimate the carbohydrate content of your meals. Your
                    API key is stored locally on your device and is never sent to our servers.
                  </p>
                  <p className="text-gray-400 mt-2">
                    Note: Carbohydrate estimates are approximations and may not be exact. For precise nutritional
                    information, consult a nutritionist or use specialized food databases.
                  </p>
                </div>
              </div>
            </ScrollArea>
          </div>
        )
    }
  }

  return (
    <main className="h-screen w-screen bg-black text-white overflow-hidden">
      {renderView()}

      <Dialog open={showApiKeyModal} onOpenChange={setShowApiKeyModal}>
        <DialogContent className="bg-gray-900 text-white border-gray-800 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Enter OpenAI API Key</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <div className="py-4">
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-gray-800 border-gray-700"
              />
              <p className="text-sm text-gray-400 mt-2">
                Your API key is stored locally and never sent to our servers.
              </p>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApiKeyModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveApiKey(apiKey)} disabled={!apiKey}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
