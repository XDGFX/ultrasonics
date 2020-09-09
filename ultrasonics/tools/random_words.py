#!/usr/bin/env python3

"""
random_words
Returns random words based on input parameters. Wordlist from @RazorSh4rk

XDGFX, 2020
"""

import io
import json
import os
import random


def words(length, separator):
    """
    Returns a string of random words of length `length`, separated by `separator`.
    """
    output = []

    with io.open(os.path.join(os.path.dirname(__file__), "wordlist.json")) as f:
        words = json.load(f)
        for i in range(length):
            n = random.randint(0, len(words))
            output.append(words[n])

    return separator.join(output)


def name():
    """
    Returns a random sentence to use as a name. There are just under 10 million possible combinations.
    """
    adjectives = ["defiant", "homeless", "adorable", "delightful", "homely", "quaint", "adventurous", "depressed", "horrible", "aggressive", "determined", "hungry", "real", "agreeable", "different", "hurt", "relieved", "alert", "difficult", "repulsive", "alive", "disgusted", "ill", "rich", "amused", "distinct", "important", "angry", "disturbed", "impossible", "scary", "annoyed", "dizzy", "inexpensive", "selfish", "annoying", "doubtful", "innocent", "shiny", "anxious", "drab", "inquisitive", "shy", "arrogant", "dull", "itchy", "silly", "ashamed", "sleepy", "attractive", "eager", "jealous", "smiling", "average", "easy", "jittery", "smoggy", "awful", "elated", "jolly", "sore", "elegant", "joyous", "sparkling", "bad", "embarrassed", "splendid", "beautiful", "enchanting", "kind", "spotless", "better", "encouraging", "stormy", "bewildered", "energetic", "lazy", "strange", "black", "enthusiastic", "light", "stupid", "bloody", "envious", "lively", "successful", "blue", "evil", "lonely", "super", "blue", "eyed", "excited", "long", "blushing", "expensive", "lovely", "talented", "bored", "exuberant", "lucky", "tame", "brainy", "tender", "brave", "fair", "magnificent", "tense", "breakable", "faithful", "misty", "terrible", "bright", "famous", "modern",
                  "tasty", "busy", "fancy", "motionless", "thankful", "fantastic", "muddy", "thoughtful", "calm", "fierce", "mushy", "thoughtless", "careful", "filthy", "mysterious", "tired", "cautious", "fine", "tough", "charming", "foolish", "nasty", "troubled", "cheerful", "fragile", "naughty", "clean", "frail", "nervous", "ugliest", "clear", "frantic", "nice", "ugly", "clever", "friendly", "nutty", "uninterested", "cloudy", "frightened", "unsightly", "clumsy", "funny", "obedient", "unusual", "colorful", "obnoxious", "upset", "combative", "gentle", "odd", "uptight", "comfortable", "gifted", "old", "fashioned", "concerned", "glamorous", "open", "vast", "condemned", "gleaming", "outrageous", "victorious", "confused", "glorious", "outstanding", "vivacious", "cooperative", "good", "courageous", "gorgeous", "panicky", "wandering", "crazy", "graceful", "perfect", "weary", "creepy", "grieving", "plain", "wicked", "crowded", "grotesque", "pleasant", "wide", "eyed", "cruel", "grumpy", "poised", "wild", "curious", "poor", "witty", "cute", "handsome", "powerful", "worrisome", "happy", "precious", "worried", "dangerous", "healthy", "prickly", "wrong", "dark", "helpful", "proud", "dead", "helpless", "putrid", "zany", "defeated", "hilarious", "puzzled", "zealous"]
    nouns = ["actor", "gold", "painting", "advertisement", "grass", "parrot", "afternoon", "greece", "pencil", "airport", "guitar", "piano", "ambulance", "hair", "pillow", "animal", "hamburger", "pizza", "answer", "helicopter", "planet", "apple", "helmet", "plastic", "army", "holiday", "portugal", "australia", "honey", "potato", "balloon", "horse", "queen", "banana", "hospital", "quill", "battery", "house", "rain", "beach", "hydrogen", "rainbow", "beard", "ice", "raincoat", "bed", "insect", "refrigerator", "belgium", "insurance", "restaurant", "boy", "iron", "river", "branch", "island", "rocket", "breakfast", "jackal", "room", "brother", "jelly", "rose", "camera", "jewellery", "russia", "candle", "jordan", "sandwich", "car", "juice", "school", "caravan", "kangaroo", "scooter", "carpet", "king", "shampoo", "cartoon", "kitchen", "shoe", "china", "kite", "soccer", "church", "knife", "spoon", "crayon", "lamp", "stone", "crowd", "lawyer",
             "sugar", "daughter", "leather", "sweden", "death", "library", "teacher", "denmark", "lighter", "telephone", "diamond", "lion", "television", "dinner", "lizard", "tent", "disease", "lock", "thailand", "doctor", "london", "tomato", "dog", "lunch", "toothbrush", "dream", "machine", "traffic", "dress", "magazine", "train", "easter", "magician", "truck", "egg", "manchester", "uganda", "eggplant", "market", "umbrella", "egypt", "match", "van", "elephant", "microphone", "vase", "energy", "monkey", "vegetable", "engine", "morning", "vulture", "england", "motorcycle", "wall", "evening", "nail", "whale", "eye", "napkin", "window", "family", "needle", "wire", "finland", "nest", "xylophone", "fish", "nigeria", "yacht", "flag", "night", "yak", "flower", "notebook", "zebra", "football", "ocean", "zoo", "forest", "oil", "garden", "fountain", "orange", "gas", "france", "oxygen", "girl", "furniture", "oyster", "glass", "garage", "ghost"]

    n0 = random.randint(0, len(adjectives))
    n1 = random.randint(0, len(adjectives))

    while n0 == n1:
        n1 = random.randint(0, len(adjectives))

    n2 = random.randint(0, len(nouns))

    return f"{adjectives[n0]} {adjectives[n1]} {nouns[n2]}"
